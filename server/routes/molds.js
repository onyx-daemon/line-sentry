const express = require('express');
const mongoose = require('mongoose');
const Mold = require('../models/Mold');
const { auth, adminAuth } = require('../middleware/auth');

const router = express.Router();

// Get all molds - Optimized
router.get('/', auth, async (req, res) => {
  try {
    let query = { isActive: true };
    
    if (req.user.role === 'operator' && req.user.departmentId) {
      query.departmentId = req.user.departmentId._id;
    }

    const molds = await Mold.find(query)
      .populate('departmentId', 'name')
      .select('-__v')
      .lean();
      
    res.json(molds);
  } catch (error) {
    console.error('Molds fetch error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get paginated molds for admin - Optimized
router.get('/admin/all', auth, adminAuth, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      search = '',
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
        { name: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
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

    // Remove __v field
    pipeline.push({ $project: { __v: 0 } });

    // Sort stage
    const sortObj = {};
    sortObj[sortBy] = sortOrder === 'asc' ? 1 : -1;
    pipeline.push({ $sort: sortObj });

    // Get total count
    const countPipeline = [...pipeline, { $count: 'total' }];
    const [countResult] = await Mold.aggregate(countPipeline);
    const totalMolds = countResult?.total || 0;

    // Add pagination
    pipeline.push({ $skip: skip }, { $limit: limitNum });

    // Execute main query
    const molds = await Mold.aggregate(pipeline);

    // Calculate pagination info
    const totalPages = Math.ceil(totalMolds / limitNum);

    res.json({
      molds,
      pagination: {
        currentPage: pageNum,
        totalPages,
        totalMolds,
        limit: limitNum,
        hasNextPage: pageNum < totalPages,
        hasPrevPage: pageNum > 1,
        nextPage: pageNum < totalPages ? pageNum + 1 : null,
        prevPage: pageNum > 1 ? pageNum - 1 : null
      },
      filters: { search, department, isActive, sortBy, sortOrder }
    });
  } catch (error) {
    console.error('Admin molds fetch error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Create mold (Admin only) - Optimized
router.post('/', auth, adminAuth, async (req, res) => {
  try {
    const { name, description, productionCapacityPerHour, departmentId } = req.body;
    
    if (!name || !productionCapacityPerHour || !departmentId) {
      return res.status(400).json({ message: 'Name, production capacity, and department are required' });
    }

    if (!mongoose.Types.ObjectId.isValid(departmentId)) {
      return res.status(400).json({ message: 'Invalid department ID' });
    }

    if (productionCapacityPerHour <= 0) {
      return res.status(400).json({ message: 'Production capacity must be greater than 0' });
    }

    // Check if department exists
    const Department = require('../models/Department');
    const deptExists = await Department.findById(departmentId).select('_id').lean();
    if (!deptExists) {
      return res.status(400).json({ message: 'Department not found' });
    }

    // Check for duplicate mold name in department
    const existingMold = await Mold.findOne({
      name: { $regex: `^${name.trim()}$`, $options: 'i' },
      departmentId: new mongoose.Types.ObjectId(departmentId)
    }).select('_id').lean();

    if (existingMold) {
      return res.status(400).json({ message: 'Mold name already exists in this department' });
    }

    const mold = new Mold({
      name: name.trim(),
      description: description?.trim() || '',
      productionCapacityPerHour: Math.max(1, parseInt(productionCapacityPerHour)),
      departmentId: new mongoose.Types.ObjectId(departmentId)
    });
    
    await mold.save();
    await mold.populate('departmentId', 'name');
    
    res.status(201).json(mold);
  } catch (error) {
    console.error('Mold creation error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Update mold (Admin only) - Optimized
router.put('/:id', auth, adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, productionCapacityPerHour, departmentId, isActive } = req.body;
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid mold ID' });
    }

    // Build update object
    const updateData = {};
    if (name !== undefined) updateData.name = name.trim();
    if (description !== undefined) updateData.description = description?.trim() || '';
    if (productionCapacityPerHour !== undefined) {
      if (productionCapacityPerHour <= 0) {
        return res.status(400).json({ message: 'Production capacity must be greater than 0' });
      }
      updateData.productionCapacityPerHour = Math.max(1, parseInt(productionCapacityPerHour));
    }
    if (departmentId !== undefined) {
      if (!mongoose.Types.ObjectId.isValid(departmentId)) {
        return res.status(400).json({ message: 'Invalid department ID' });
      }
      updateData.departmentId = new mongoose.Types.ObjectId(departmentId);
    }
    if (isActive !== undefined) updateData.isActive = isActive;

    // Check for duplicate name if name is being updated
    if (name) {
      const duplicateQuery = {
        name: { $regex: `^${name.trim()}$`, $options: 'i' },
        departmentId: updateData.departmentId || req.body.departmentId,
        _id: { $ne: id }
      };
      
      const existingMold = await Mold.findOne(duplicateQuery).select('_id').lean();
      if (existingMold) {
        return res.status(400).json({ message: 'Mold name already exists in this department' });
      }
    }

    const mold = await Mold.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    ).populate('departmentId', 'name');
    
    if (!mold) {
      return res.status(404).json({ message: 'Mold not found' });
    }
    
    res.json(mold);
  } catch (error) {
    console.error('Mold update error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Delete mold (Admin only) - Optimized
router.delete('/:id', auth, adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid mold ID' });
    }
    
    const mold = await Mold.findByIdAndDelete(id).select('name').lean();
    
    if (!mold) {
      return res.status(404).json({ message: 'Mold not found' });
    }
    
    res.json({ message: 'Mold deleted successfully' });
  } catch (error) {
    console.error('Mold deletion error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Toggle mold active status - Optimized
router.patch('/:id/status', auth, adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid mold ID' });
    }

    const mold = await Mold.findById(id).select('isActive name');
    if (!mold) {
      return res.status(404).json({ message: 'Mold not found' });
    }

    mold.isActive = !mold.isActive;
    await mold.save();

    res.json({ 
      message: `Mold ${mold.isActive ? 'activated' : 'deactivated'} successfully`,
      mold: { _id: mold._id, isActive: mold.isActive }
    });
  } catch (error) {
    console.error('Mold status toggle error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;