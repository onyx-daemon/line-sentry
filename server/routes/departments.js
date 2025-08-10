const express = require('express');
const Department = require('../models/Department');
const Machine = require('../models/Machine');
const Molds = require('../models/Mold');
const { auth, adminAuth } = require('../middleware/auth');

const router = express.Router();

// Get all departments - Optimized
router.get('/', auth, async (req, res) => {
  try {
    let query = { isActive: true };
    
    if (req.user.role === 'operator' && req.user.departmentId) {
      query._id = req.user.departmentId._id;
    }

    // Use aggregation pipeline for better performance
    const pipeline = [
      { $match: query },
      {
        $lookup: {
          from: 'machines',
          let: { deptId: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$departmentId', '$$deptId'] },
                    { $eq: ['$isActive', true] }
                  ]
                }
              }
            }
          ],
          as: 'machines'
        }
      },
      {
        $addFields: {
          machineCount: { $size: '$machines' }
        }
      }
    ];

    const departments = await Department.aggregate(pipeline);
    res.json(departments);
  } catch (error) {
    console.error('Departments fetch error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get paginated departments for admin - Optimized
router.get('/admin/all', auth, adminAuth, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      search = '',
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
    if (isActive !== '') {
      matchStage.isActive = isActive === 'true';
    }
    
    if (Object.keys(matchStage).length > 0) {
      pipeline.push({ $match: matchStage });
    }

    // Add machine count lookup
    pipeline.push({
      $lookup: {
        from: 'machines',
        let: { deptId: '$_id' },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ['$departmentId', '$$deptId'] },
                  { $eq: ['$isActive', true] }
                ]
              }
            }
          }
        ],
        as: 'machines'
      }
    });

    pipeline.push({
      $addFields: {
        machineCount: { $size: '$machines' }
      }
    });

    // Sort stage
    const sortObj = {};
    sortObj[sortBy] = sortOrder === 'asc' ? 1 : -1;
    pipeline.push({ $sort: sortObj });

    // Get total count
    const countPipeline = [...pipeline, { $count: 'total' }];
    const [countResult] = await Department.aggregate(countPipeline);
    const totalDepartments = countResult?.total || 0;

    // Add pagination
    pipeline.push({ $skip: skip }, { $limit: limitNum });

    // Execute main query
    const departments = await Department.aggregate(pipeline);

    // Calculate pagination info
    const totalPages = Math.ceil(totalDepartments / limitNum);

    res.json({
      departments,
      pagination: {
        currentPage: pageNum,
        totalPages,
        totalDepartments,
        limit: limitNum,
        hasNextPage: pageNum < totalPages,
        hasPrevPage: pageNum > 1,
        nextPage: pageNum < totalPages ? pageNum + 1 : null,
        prevPage: pageNum > 1 ? pageNum - 1 : null
      },
      filters: { search, isActive, sortBy, sortOrder }
    });
  } catch (error) {
    console.error('Admin departments fetch error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get department by ID with machines - Optimized
router.get('/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid department ID' });
    }

    // Check operator permissions
    if (req.user.role === 'operator' && 
        req.user.departmentId?._id.toString() !== id) {
      return res.status(403).json({ message: 'Access denied to this department' });
    }

    // Use aggregation for single query
    const pipeline = [
      { $match: { _id: new mongoose.Types.ObjectId(id) } },
      {
        $lookup: {
          from: 'machines',
          let: { deptId: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$departmentId', '$$deptId'] },
                    { $eq: ['$isActive', true] }
                  ]
                }
              }
            }
          ],
          as: 'machines'
        }
      }
    ];

    const [department] = await Department.aggregate(pipeline);
    
    if (!department) {
      return res.status(404).json({ message: 'Department not found' });
    }
    
    res.json(department);
  } catch (error) {
    console.error('Department fetch error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Create department (Admin only) - Optimized
router.post('/', auth, adminAuth, async (req, res) => {
  try {
    const { name, description } = req.body;
    
    if (!name || name.trim() === '') {
      return res.status(400).json({ message: 'Department name is required' });
    }

    // Check for duplicate name
    const existingDept = await Department.findOne({ 
      name: { $regex: `^${name.trim()}$`, $options: 'i' } 
    }).select('_id').lean();
    
    if (existingDept) {
      return res.status(400).json({ message: 'Department name already exists' });
    }

    const department = new Department({
      name: name.trim(),
      description: description?.trim() || ''
    });
    
    await department.save();
    res.status(201).json(department);
  } catch (error) {
    console.error('Department creation error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Update department (Admin only) - Optimized
router.put('/:id', auth, adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, isActive } = req.body;
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid department ID' });
    }

    // Check for duplicate name if name is being updated
    if (name) {
      const existingDept = await Department.findOne({ 
        name: { $regex: `^${name.trim()}$`, $options: 'i' },
        _id: { $ne: id }
      }).select('_id').lean();
      
      if (existingDept) {
        return res.status(400).json({ message: 'Department name already exists' });
      }
    }

    const updateData = {};
    if (name !== undefined) updateData.name = name.trim();
    if (description !== undefined) updateData.description = description?.trim() || '';
    if (isActive !== undefined) updateData.isActive = isActive;

    const department = await Department.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    );
    
    if (!department) {
      return res.status(404).json({ message: 'Department not found' });
    }
    
    res.json(department);
  } catch (error) {
    console.error('Department update error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Delete department (Admin only) - Optimized with transaction
router.delete('/:id', auth, adminAuth, async (req, res) => {
  const session = await mongoose.startSession();
  
  try {
    const { id } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid department ID' });
    }

    await session.withTransaction(async () => {
      // Check if department exists
      const department = await Department.findById(id).session(session);
      if (!department) {
        throw new Error('Department not found');
      }

      // Delete in order: molds, machines, then department
      await Promise.all([
        Molds.deleteMany({ departmentId: id }).session(session),
        Machine.deleteMany({ departmentId: id }).session(session)
      ]);

      await Department.findByIdAndDelete(id).session(session);
    });

    res.json({ message: 'Department and all associated data deleted successfully' });
  } catch (error) {
    console.error('Department deletion error:', error);
    res.status(500).json({ 
      message: error.message === 'Department not found' ? error.message : 'Server error', 
      error: error.message 
    });
  } finally {
    await session.endSession();
  }
});

module.exports = router;