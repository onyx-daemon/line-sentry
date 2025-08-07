const express = require('express');
const Department = require('../models/Department');
const Machine = require('../models/Machine');
const Molds = require('../models/Mold');
const { auth, adminAuth } = require('../middleware/auth');
const cacheManager = require('../utils/cache');

const router = express.Router();

// Get all departments (optimized with caching)
router.get('/', auth, async (req, res) => {
  try {
    let query = { isActive: true };
    
    if (req.user.role === 'operator' && req.user.departmentId) {
      query._id = req.user.departmentId._id;
    }

    // Try cache first
    let departments = cacheManager.getDepartments();
    
    if (!departments) {
      // Single aggregation query to get departments with machine counts
      const aggregation = [
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

      departments = await Department.aggregate(aggregation);
      
      // Cache for future requests
      cacheManager.setDepartments(departments);
    }

    // Filter for operators if needed
    if (req.user.role === 'operator' && req.user.departmentId) {
      departments = departments.filter(dept => dept._id.toString() === req.user.departmentId._id.toString());
    }

    res.json(departments);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get all paginated departments (optimized)
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

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    // Build aggregation pipeline for better performance
    const pipeline = [];

    // Match stage
    let matchStage = {};
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
          },
          { $project: { _id: 1 } }
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
    const [departments, countResult] = await Promise.all([
      Department.aggregate([
        ...pipeline,
        { $skip: skip },
        { $limit: limitNum }
      ]),
      Department.aggregate(countPipeline)
    ]);

    const totalDepartments = countResult[0]?.total || 0;
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
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get department by ID with machines (optimized)
router.get('/:id', auth, async (req, res) => {
  try {
    // Check if operator is accessing their own department
    if (req.user.role === 'operator' && req.user.departmentId?._id.toString() !== req.params.id) {
      return res.status(403).json({ message: 'Access denied to this department' });
    }

    // Single aggregation to get department with machines
    const aggregation = [
      { $match: { _id: new mongoose.Types.ObjectId(req.params.id) } },
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

    const result = await Department.aggregate(aggregation);
    const department = result[0];

    if (!department) {
      return res.status(404).json({ message: 'Department not found' });
    }

    res.json(department);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Create department (Admin only)
router.post('/', auth, adminAuth, async (req, res) => {
  try {
    const department = new Department(req.body);
    await department.save();
    
    // Invalidate cache
    cacheManager.invalidateDepartments();
    
    res.status(201).json(department);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Update department (Admin only)
router.put('/:id', auth, adminAuth, async (req, res) => {
  try {
    const department = await Department.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true }
    );
    
    if (!department) {
      return res.status(404).json({ message: 'Department not found' });
    }
    
    // Invalidate cache
    cacheManager.invalidateDepartments();
    
    res.json(department);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Delete department (Admin only)
router.delete('/:id', auth, adminAuth, async (req, res) => {
  try {
    const department = await Department.findById(req.params.id);
    if (!department) {
      return res.status(404).json({ message: 'Department not found' });
    }

    // Batch delete operations
    await Promise.all([
      Machine.deleteMany({ departmentId: req.params.id }),
      Molds.deleteMany({ departmentId: req.params.id }),
      Department.findByIdAndDelete(req.params.id)
    ]);

    // Invalidate caches
    cacheManager.invalidateDepartments();
    cacheManager.invalidateMolds();

    res.json({ message: 'Department, associated machines, and associated molds deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;