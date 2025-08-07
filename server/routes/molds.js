const express = require('express');
const Mold = require('../models/Mold');
const { auth, adminAuth } = require('../middleware/auth');
const cacheManager = require('../utils/cache');

const router = express.Router();

// Get all molds (optimized with caching)
router.get('/', auth, async (req, res) => {
  try {
    let query = { isActive: true };
    
    if (req.user.role === 'operator' && req.user.departmentId) {
      query.departmentId = req.user.departmentId._id;
    }

    // Try cache first
    let molds = cacheManager.getMolds();
    
    if (!molds) {
      molds = await Mold.find({})
        .populate('departmentId', 'name _id')
        .lean();
      
      // Cache all molds
      cacheManager.setMolds(molds);
    }

    // Filter based on query
    const filteredMolds = molds.filter(mold => {
      if (!mold.isActive && query.isActive) return false;
      
      if (req.user.role === 'operator' && req.user.departmentId) {
        return mold.departmentId?._id?.toString() === req.user.departmentId._id.toString();
      }
      
      return true;
    });

    res.json(filteredMolds);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get paginated molds for admin (optimized)
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

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    // Build aggregation pipeline
    const pipeline = [];

    // Match stage
    let matchStage = {};
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
        departmentInfo: 0
      }
    });

    // Sort stage
    const sortObj = {};
    sortObj[sortBy] = sortOrder === 'asc' ? 1 : -1;
    pipeline.push({ $sort: sortObj });

    // Get total count and paginated results
    const countPipeline = [...pipeline, { $count: 'total' }];
    const [molds, countResult] = await Promise.all([
      Mold.aggregate([
        ...pipeline,
        { $skip: skip },
        { $limit: limitNum }
      ]),
      Mold.aggregate(countPipeline)
    ]);

    const totalMolds = countResult[0]?.total || 0;
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
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Create mold (Admin only)
router.post('/', auth, adminAuth, async (req, res) => {
  try {
    const mold = new Mold(req.body);
    await mold.save();
    
    // Invalidate cache
    cacheManager.invalidateMolds();
    
    res.status(201).json(mold);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Update mold (Admin only)
router.put('/:id', auth, adminAuth, async (req, res) => {
  try {
    const mold = await Mold.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true }
    ).populate('departmentId');
    
    if (!mold) {
      return res.status(404).json({ message: 'Mold not found' });
    }
    
    // Invalidate cache
    cacheManager.invalidateMolds();
    
    res.json(mold);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Delete mold (Admin only)
router.delete('/:id', auth, adminAuth, async (req, res) => {
  try {
    const mold = await Mold.findByIdAndDelete(req.params.id);
    if (!mold) {
      return res.status(404).json({ message: 'Mold not found' });
    }
    
    // Invalidate cache
    cacheManager.invalidateMolds();
    
    res.json({ message: 'Mold deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Toggle mold active status
router.patch('/:id/status', auth, adminAuth, async (req, res) => {
  try {
    const mold = await Mold.findById(req.params.id);
    if (!mold) {
      return res.status(404).json({ message: 'Mold not found' });
    }

    mold.isActive = !mold.isActive;
    await mold.save();

    // Invalidate cache
    cacheManager.invalidateMolds();

    res.json({ 
      message: `Mold ${mold.isActive ? 'activated' : 'deactivated'} successfully`,
      mold
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;