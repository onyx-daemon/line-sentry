const express = require('express');
const User = require('../models/User');
const { auth, adminAuth } = require('../middleware/auth');
const cacheManager = require('../utils/cache');

const router = express.Router();

// Get all users without pagination (optimized with caching)
router.get('/', auth, async (req, res) => {
  try {
    let query = { isActive: true };
    
    // Operators only see users in their department
    if (req.user.role === 'operator' && req.user.departmentId) {
      query.departmentId = req.user.departmentId;
    }

    // Try cache first
    let users = cacheManager.getUsers();
    
    if (!users) {
      users = await User.find({})
        .populate('departmentId', 'name _id')
        .select('-password')
        .lean();
      
      // Cache all users
      cacheManager.setUsers(users);
    }

    // Filter based on query
    const filteredUsers = users.filter(user => {
      if (!query.isActive || user.isActive !== query.isActive) {
        if (query.isActive !== undefined && user.isActive !== query.isActive) return false;
      }
      
      if (req.user.role === 'operator' && req.user.departmentId) {
        return user.departmentId?._id?.toString() === req.user.departmentId.toString();
      }
      
      return user.isActive === true;
    });

    res.json(filteredUsers);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get all users with pagination and search (Admin only) - optimized
router.get('/admin/all', auth, adminAuth, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      search = '',
      role = '',
      department = '',
      isActive = '',
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    // Build aggregation pipeline
    const pipeline = [];

    // Match stage
    let matchStage = {};
    if (search.trim()) {
      matchStage.$or = [
        { username: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }
    if (role.trim()) matchStage.role = role;
    if (department.trim()) matchStage.departmentId = new mongoose.Types.ObjectId(department);
    if (isActive !== '') matchStage.isActive = isActive === 'true';

    if (Object.keys(matchStage).length > 0) {
      pipeline.push({ $match: matchStage });
    }

    // Lookup department info
    pipeline.push({
      $lookup: {
        from: 'departments',
        localField: 'departmentId',
        foreignField: '_id',
        as: 'departmentInfo'
      }
    });

    pipeline.push({
      $addFields: {
        departmentId: { $arrayElemAt: ['$departmentInfo', 0] }
      }
    });

    pipeline.push({
      $project: {
        password: 0,
        departmentInfo: 0
      }
    });

    // Sort stage
    const sortObj = {};
    sortObj[sortBy] = sortOrder === 'asc' ? 1 : -1;
    pipeline.push({ $sort: sortObj });

    // Get total count and paginated results
    const countPipeline = [...pipeline, { $count: 'total' }];
    const [users, countResult] = await Promise.all([
      User.aggregate([
        ...pipeline,
        { $skip: skip },
        { $limit: limitNum }
      ]),
      User.aggregate(countPipeline)
    ]);

    const totalUsers = countResult[0]?.total || 0;
    const totalPages = Math.ceil(totalUsers / limitNum);

    res.json({
      users,
      pagination: {
        currentPage: pageNum,
        totalPages,
        totalUsers,
        limit: limitNum,
        hasNextPage: pageNum < totalPages,
        hasPrevPage: pageNum > 1,
        nextPage: pageNum < totalPages ? pageNum + 1 : null,
        prevPage: pageNum > 1 ? pageNum - 1 : null
      },
      filters: { search, role, department, isActive, sortBy, sortOrder }
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Create user (Admin only)
router.post('/', auth, adminAuth, async (req, res) => {
  try {
    const { role, departmentId } = req.body;
    
    if (role === 'operator' && !departmentId) {
      return res.status(400).json({ message: 'Department is required for operators' });
    }
    
    const userData = {
      ...req.body,
      departmentId: role === 'operator' ? departmentId : undefined
    };

    const user = new User(userData);
    await user.save();
    
    // Invalidate cache
    cacheManager.invalidateUsers();
    
    const userWithoutPassword = user.toObject();
    delete userWithoutPassword.password;
    
    res.status(201).json(userWithoutPassword);
  } catch (error) {
    let message = 'Server error';
    
    if (error.code === 11000) {
      if (error.keyPattern.username) {
        message = 'Username already exists';
      } else if (error.keyPattern.email) {
        message = 'Email already exists';
      }
    }
    
    res.status(500).json({ message, error: error.message });
  }
});

// Update user (Admin only)
router.put('/:id', auth, adminAuth, async (req, res) => {
  try {
    // Prevent admin from deactivating their own account or other admin accounts
    if (req.body.isActive === false) {
      const targetUser = await User.findById(req.params.id).lean();
      if (!targetUser) {
        return res.status(404).json({ message: 'User not found' });
      }
      
      if (targetUser._id.toString() === req.user._id.toString()) {
        return res.status(400).json({ message: 'You cannot deactivate your own account' });
      }
      
      if (targetUser.role === 'admin') {
        return res.status(400).json({ message: 'You cannot deactivate other admin accounts' });
      }
    }
    
    const { password, ...updateData } = req.body;
    
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Update fields efficiently
    Object.keys(updateData).forEach(key => {
      if (updateData[key] !== undefined) {
        if (key === 'role' && updateData[key] !== 'operator') {
          user.departmentId = undefined;
        }
        user[key] = updateData[key];
      }
    });

    // Only update password if provided
    if (password && password.trim() !== '') {
      user.password = password;
    }

    const updatedUser = await user.save();
    
    // Invalidate cache
    cacheManager.invalidateUsers();
    
    const userWithoutPassword = updatedUser.toObject();
    delete userWithoutPassword.password;
    res.json(userWithoutPassword);
    
  } catch (error) {
    let message = 'Server error';
    
    if (error.code === 11000) {
      if (error.keyPattern.username) {
        message = 'Username already exists';
      } else if (error.keyPattern.email) {
        message = 'Email already exists';
      }
    }
    
    res.status(500).json({ message, error: error.message });
  }
});

// Delete user (Admin only)
router.delete('/:id', auth, adminAuth, async (req, res) => {
  try {
    if (req.params.id === req.user._id.toString()) {
      return res.status(400).json({ message: 'You cannot delete your own account' });
    }
    
    const user = await User.findByIdAndDelete(req.params.id);
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    // Invalidate cache
    cacheManager.invalidateUsers();
    
    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;