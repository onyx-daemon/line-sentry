const express = require('express');
const Mold = require('../models/Mold');
const { auth, adminAuth } = require('../middleware/auth');

const router = express.Router();

// Get all molds
router.get('/', auth, async (req, res) => {
  try {
    let query = { isActive: true };
    
    if (req.user.role === 'operator' && req.user.departmentId) {
      query.departmentId = req.user.departmentId._id;
    }

    const molds = await Mold.find(query).populate('departmentId');
    res.json(molds);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get paginated molds for admin
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

    // Convert page and limit to numbers
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    // Build search query
    let query = {};

    // Text search across name, description
    if (search.trim()) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }

    // Filter by department
    if (department.trim()) {
      query.departmentId = department;
    }

    // Filter by active status
    if (isActive !== '') {
      query.isActive = isActive === 'true';
    }

    // Build sort object
    const sortObj = {};
    sortObj[sortBy] = sortOrder === 'asc' ? 1 : -1;

    // Execute queries
    const [molds, totalMolds] = await Promise.all([
      Mold.find(query)
        .populate('departmentId')
        .sort(sortObj)
        .skip(skip)
        .limit(limitNum),
      Mold.countDocuments(query)
    ]);

    // Calculate pagination info
    const totalPages = Math.ceil(totalMolds / limitNum);
    const hasNextPage = pageNum < totalPages;
    const hasPrevPage = pageNum > 1;

    res.json({
      molds,
      pagination: {
        currentPage: pageNum,
        totalPages,
        totalMolds,
        limit: limitNum,
        hasNextPage,
        hasPrevPage,
        nextPage: hasNextPage ? pageNum + 1 : null,
        prevPage: hasPrevPage ? pageNum - 1 : null
      },
      filters: {
        search,
        department,
        isActive,
        sortBy,
        sortOrder
      }
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
    
    res.json(mold);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Delete mold (Admin only) - hard delete
router.delete('/:id', auth, adminAuth, async (req, res) => {
  try {
    const mold = await Mold.findByIdAndDelete(req.params.id);
    if (!mold) {
      return res.status(404).json({ message: 'Mold not found' });
    }
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

    res.json({ 
      message: `Mold ${mold.isActive ? 'activated' : 'deactivated'} successfully`,
      mold
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;