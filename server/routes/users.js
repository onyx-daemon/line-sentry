const express = require('express');
const mongoose = require('mongoose');
const User = require('../models/User');
const { auth, adminAuth } = require('../middleware/auth');

const router = express.Router();

// Get all users without pagination - Optimized
router.get('/', auth, async (req, res) => {
  try {
    let query = { isActive: true };
    
    // Operators only see users in their department
    if (req.user.role === 'operator' && req.user.departmentId) {
      query.departmentId = req.user.departmentId._id;
    }

    const users = await User.find(query)
      .populate('departmentId', 'name _id')
      .select('-password -__v')
      .lean();

    res.json(users);
  } catch (error) {
    console.error('Users fetch error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get paginated users for admin - Optimized
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

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.max(1, Math.min(100, parseInt(limit)));
    const skip = (pageNum - 1) * limitNum;

    // Build aggregation pipeline
    const pipeline = [];

    // Match stage
    const matchStage = {};
    if (search.trim()) {
      matchStage.$or = [
        { username: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }
    if (role.trim()) {
      matchStage.role = role;
    }
    if (department.trim()) {
      matchStage.departmentId = new mongoose.Types.ObjectId(department);
    }
    if (isActive !== '') {
      matchStage.isActive = isActive === 'true';
    }

    if (Object.keys(matchStage).length > 0) {
      pipeline.push({ $match: matchStage });
    }

    // Lookup department info
    pipeline.push({
      $lookup: {
        from: 'departments',
        localField: 'departmentId',
        foreignField: '_id',
        as: 'departmentId',
        pipeline: [{ $project: { name: 1 } }]
      }
    });

    pipeline.push({
      $unwind: { path: '$departmentId', preserveNullAndEmptyArrays: true }
    });

    // Remove password field
    pipeline.push({
      $project: { password: 0, __v: 0 }
    });

    // Sort stage
    const sortObj = {};
    sortObj[sortBy] = sortOrder === 'asc' ? 1 : -1;
    pipeline.push({ $sort: sortObj });

    // Get total count
    const countPipeline = [...pipeline, { $count: 'total' }];
    const [countResult] = await User.aggregate(countPipeline);
    const totalUsers = countResult?.total || 0;

    // Add pagination
    pipeline.push({ $skip: skip }, { $limit: limitNum });

    // Execute main query
    const users = await User.aggregate(pipeline);

    // Calculate pagination info
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
    console.error('Admin users fetch error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Create user (Admin only) - Optimized
router.post('/', auth, adminAuth, async (req, res) => {
  try {
    const { username, email, password, role, departmentId } = req.body;
    
    // Validate required fields
    if (!username || !email || !password || !role) {
      return res.status(400).json({ message: 'All required fields must be provided' });
    }

    if (role === 'operator' && !departmentId) {
      return res.status(400).json({ message: 'Department is required for operators' });
    }

    // Check for existing username/email in single query
    const existingUser = await User.findOne({
      $or: [
        { username: { $regex: `^${username.trim()}$`, $options: 'i' } },
        { email: { $regex: `^${email.trim()}$`, $options: 'i' } }
      ]
    }).select('username email').lean();

    if (existingUser) {
      const field = existingUser.username.toLowerCase() === username.toLowerCase() ? 'Username' : 'Email';
      return res.status(400).json({ message: `${field} already exists` });
    }

    // Validate department if provided
    if (departmentId && !mongoose.Types.ObjectId.isValid(departmentId)) {
      return res.status(400).json({ message: 'Invalid department ID' });
    }

    if (departmentId) {
      const Department = require('../models/Department');
      const deptExists = await Department.findById(departmentId).select('_id').lean();
      if (!deptExists) {
        return res.status(400).json({ message: 'Department not found' });
      }
    }

    const userData = {
      username: username.trim(),
      email: email.trim().toLowerCase(),
      password: password.trim(),
      role,
      departmentId: role === 'operator' && departmentId ? new mongoose.Types.ObjectId(departmentId) : undefined
    };

    const user = new User(userData);
    await user.save();
    
    // Return user without password
    const userResponse = user.toObject();
    delete userResponse.password;
    delete userResponse.__v;
    
    res.status(201).json(userResponse);
  } catch (error) {
    console.error('User creation error:', error);
    
    let message = 'Server error';
    if (error.code === 11000) {
      if (error.keyPattern?.username) {
        message = 'Username already exists';
      } else if (error.keyPattern?.email) {
        message = 'Email already exists';
      }
    }
    
    res.status(500).json({ message, error: error.message });
  }
});

// Update user (Admin only) - Optimized
router.put('/:id', auth, adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { username, email, password, role, departmentId, isActive } = req.body;
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid user ID' });
    }

    // Get current user data
    const currentUser = await User.findById(id).select('role').lean();
    if (!currentUser) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Prevent admin from deactivating their own account
    if (isActive === false && id === req.user._id.toString()) {
      return res.status(400).json({ message: 'You cannot deactivate your own account' });
    }

    // Prevent deactivating other admin accounts
    if (isActive === false && currentUser.role === 'admin') {
      return res.status(400).json({ message: 'You cannot deactivate other admin accounts' });
    }

    // Check for duplicate username/email if being updated
    if (username || email) {
      const duplicateQuery = { _id: { $ne: id } };
      const orConditions = [];
      
      if (username) {
        orConditions.push({ username: { $regex: `^${username.trim()}$`, $options: 'i' } });
      }
      if (email) {
        orConditions.push({ email: { $regex: `^${email.trim()}$`, $options: 'i' } });
      }
      
      if (orConditions.length > 0) {
        duplicateQuery.$or = orConditions;
        
        const existingUser = await User.findOne(duplicateQuery).select('username email').lean();
        if (existingUser) {
          const field = username && existingUser.username.toLowerCase() === username.toLowerCase() 
            ? 'Username' : 'Email';
          return res.status(400).json({ message: `${field} already exists` });
        }
      }
    }

    // Build update object
    const updateData = {};
    if (username !== undefined) updateData.username = username.trim();
    if (email !== undefined) updateData.email = email.trim().toLowerCase();
    if (role !== undefined) {
      updateData.role = role;
      if (role !== 'operator') {
        updateData.departmentId = undefined;
      }
    }
    if (departmentId !== undefined && role === 'operator') {
      if (!mongoose.Types.ObjectId.isValid(departmentId)) {
        return res.status(400).json({ message: 'Invalid department ID' });
      }
      updateData.departmentId = new mongoose.Types.ObjectId(departmentId);
    }
    if (isActive !== undefined) updateData.isActive = isActive;
    if (password && password.trim() !== '') {
      updateData.password = password.trim();
    }

    const updatedUser = await User.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    )
    .populate('departmentId', 'name')
    .select('-password -__v');
    
    res.json(updatedUser);
  } catch (error) {
    console.error('User update error:', error);
    
    let message = 'Server error';
    if (error.code === 11000) {
      if (error.keyPattern?.username) {
        message = 'Username already exists';
      } else if (error.keyPattern?.email) {
        message = 'Email already exists';
      }
    }
    
    res.status(500).json({ message, error: error.message });
  }
});

// Delete user (Admin only) - Optimized
router.delete('/:id', auth, adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid user ID' });
    }
    
    if (id === req.user._id.toString()) {
      return res.status(400).json({ message: 'You cannot delete your own account' });
    }
    
    const user = await User.findByIdAndDelete(id).select('username').lean();
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    console.error('User deletion error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;