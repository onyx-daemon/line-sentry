const express = require('express');
const Machine = require('../models/Machine');
const SignalData = require('../models/SignalData');
const Sensor = require('../models/Sensor');
const ProductionRecord = require('../models/ProductionRecord');
const { auth, adminAuth } = require('../middleware/auth');
const cacheManager = require('../utils/cache');

const router = express.Router();

// Get machines by department (optimized)
router.get('/department/:departmentId', auth, async (req, res) => {
  try {
    // Check if operator is accessing their own department
    if (req.user.role === 'operator' && req.user.departmentId?._id.toString() !== req.params.departmentId) {
      return res.status(403).json({ message: 'Access denied to this department' });
    }

    // Use lean() for better performance and single query
    const machines = await Machine.find({ 
      departmentId: req.params.departmentId, 
      isActive: true 
    })
    .populate('departmentId', 'name _id')
    .lean();
    
    res.json(machines);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get machine by ID (optimized)
router.get('/:id', auth, async (req, res) => {
  try {
    const machine = await Machine.findById(req.params.id)
      .populate('departmentId', 'name _id')
      .lean();
    
    if (!machine) {
      return res.status(404).json({ message: 'Machine not found' });
    }

    // Check if operator is accessing machine from their department
    if (req.user.role === 'operator' && req.user.departmentId?._id.toString() !== machine.departmentId._id.toString()) {
      return res.status(403).json({ message: 'Access denied to this machine' });
    }

    res.json(machine);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get all machines (Admin only) - optimized
router.get('/', auth, adminAuth, async (req, res) => {
  try {
    const machines = await Machine.find({ isActive: true })
      .populate('departmentId', 'name _id')
      .lean();
    
    res.json(machines);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Create machine (Admin only)
router.post('/', auth, adminAuth, async (req, res) => {
  try {
    const machine = new Machine({
      ...req.body,
      dimensions: req.body.dimensions || { width: 200, height: 200 },
      status: req.body.status || 'inactive'
    });
    await machine.save();
    
    // Invalidate department cache
    cacheManager.invalidateDepartments();
    
    res.status(201).json(machine);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Update machine (optimized)
router.put('/:id', auth, adminAuth, async (req, res) => {
  try {
    const machine = await Machine.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, lean: true }
    );
    
    if (!machine) {
      return res.status(404).json({ message: 'Machine not found' });
    }
    
    // Invalidate related caches
    cacheManager.invalidateDepartments();
    cacheManager.invalidateMachineStats(req.params.id);
    
    res.json(machine);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Update machine position (optimized)
router.patch('/:id/position', auth, adminAuth, async (req, res) => {
  try {
    const { x, y, width, height } = req.body;
    
    const machine = await Machine.findByIdAndUpdate(
      req.params.id,
      { 
        position: { x, y },
        dimensions: { width, height }
      },
      { new: true, lean: true }
    );
    
    if (!machine) {
      return res.status(404).json({ message: 'Machine not found' });
    }
    
    res.json(machine);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Delete machine (Admin only) - optimized with batch operations
router.delete('/:id', auth, adminAuth, async (req, res) => {
  try {
    const machineId = req.params.id;
    
    // Batch delete all related data
    const deleteOperations = [
      Sensor.deleteMany({ machineId }),
      ProductionRecord.deleteMany({ machineId }),
      SignalData.deleteMany({ machineId }),
      Machine.findByIdAndDelete(machineId)
    ];
    
    const results = await Promise.all(deleteOperations);
    const machine = results[3]; // Machine delete result
    
    if (!machine) {
      return res.status(404).json({ message: 'Machine not found' });
    }
    
    // Invalidate related caches
    cacheManager.invalidateDepartments();
    cacheManager.invalidateMachineStats(machineId);
    
    res.json({ message: 'Machine and all related data deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;