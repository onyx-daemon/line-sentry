const express = require('express');
const mongoose = require('mongoose');
const Machine = require('../models/Machine');
const SignalData = require('../models/SignalData');
const Sensor = require('../models/Sensor');
const ProductionRecord = require('../models/ProductionRecord');
const { auth, adminAuth } = require('../middleware/auth');

const router = express.Router();

// Get machines by department - Optimized
router.get('/department/:departmentId', auth, async (req, res) => {
  try {
    const { departmentId } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(departmentId)) {
      return res.status(400).json({ message: 'Invalid department ID' });
    }

    // Check operator permissions
    if (req.user.role === 'operator' && 
        req.user.departmentId?._id.toString() !== departmentId) {
      return res.status(403).json({ message: 'Access denied to this department' });
    }

    const machines = await Machine.find({ 
      departmentId: new mongoose.Types.ObjectId(departmentId), 
      isActive: true 
    })
    .populate('departmentId', 'name')
    .lean();
    
    res.json(machines);
  } catch (error) {
    console.error('Machines by department error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get machine by ID - Optimized
router.get('/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid machine ID' });
    }

    const machine = await Machine.findById(id)
      .populate('departmentId', 'name _id')
      .lean();
      
    if (!machine) {
      return res.status(404).json({ message: 'Machine not found' });
    }

    // Check operator permissions
    if (req.user.role === 'operator' && 
        req.user.departmentId?._id.toString() !== machine.departmentId._id.toString()) {
      return res.status(403).json({ message: 'Access denied to this machine' });
    }

    res.json(machine);
  } catch (error) {
    console.error('Machine fetch error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get all machines (Admin only) - Optimized
router.get('/', auth, adminAuth, async (req, res) => {
  try {
    const machines = await Machine.find({ isActive: true })
      .populate('departmentId', 'name')
      .select('-__v')
      .lean();
      
    res.json(machines);
  } catch (error) {
    console.error('All machines fetch error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Create machine (Admin only) - Optimized
router.post('/', auth, adminAuth, async (req, res) => {
  try {
    const { name, description, departmentId } = req.body;
    
    if (!name || name.trim() === '') {
      return res.status(400).json({ message: 'Machine name is required' });
    }

    if (!departmentId || !mongoose.Types.ObjectId.isValid(departmentId)) {
      return res.status(400).json({ message: 'Valid department ID is required' });
    }

    // Check if department exists
    const Department = require('../models/Department');
    const departmentExists = await Department.findById(departmentId)
      .select('_id')
      .lean();
      
    if (!departmentExists) {
      return res.status(400).json({ message: 'Department not found' });
    }

    // Check for duplicate machine name in department
    const existingMachine = await Machine.findOne({
      name: { $regex: `^${name.trim()}$`, $options: 'i' },
      departmentId: new mongoose.Types.ObjectId(departmentId)
    }).select('_id').lean();

    if (existingMachine) {
      return res.status(400).json({ message: 'Machine name already exists in this department' });
    }

    const machine = new Machine({
      name: name.trim(),
      description: description?.trim() || '',
      departmentId: new mongoose.Types.ObjectId(departmentId),
      dimensions: req.body.dimensions || { width: 200, height: 200 },
      position: req.body.position || { x: 50, y: 50 },
      status: 'inactive'
    });
    
    await machine.save();
    
    // Populate department info for response
    await machine.populate('departmentId', 'name');
    
    res.status(201).json(machine);
  } catch (error) {
    console.error('Machine creation error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Update machine - Optimized
router.put('/:id', auth, adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, departmentId } = req.body;
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid machine ID' });
    }

    // Build update object
    const updateData = {};
    if (name !== undefined) updateData.name = name.trim();
    if (description !== undefined) updateData.description = description?.trim() || '';
    if (departmentId !== undefined) {
      if (!mongoose.Types.ObjectId.isValid(departmentId)) {
        return res.status(400).json({ message: 'Invalid department ID' });
      }
      updateData.departmentId = new mongoose.Types.ObjectId(departmentId);
    }

    // Check for duplicate name if name is being updated
    if (name) {
      const existingMachine = await Machine.findOne({
        name: { $regex: `^${name.trim()}$`, $options: 'i' },
        departmentId: updateData.departmentId || req.body.departmentId,
        _id: { $ne: id }
      }).select('_id').lean();

      if (existingMachine) {
        return res.status(400).json({ message: 'Machine name already exists in this department' });
      }
    }

    const machine = await Machine.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    ).populate('departmentId', 'name');
    
    if (!machine) {
      return res.status(404).json({ message: 'Machine not found' });
    }
    
    res.json(machine);
  } catch (error) {
    console.error('Machine update error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Update machine position (for drag and drop) - Optimized
router.patch('/:id/position', auth, adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { x, y, width, height } = req.body;
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid machine ID' });
    }

    // Validate position values
    if (typeof x !== 'number' || typeof y !== 'number' || 
        typeof width !== 'number' || typeof height !== 'number') {
      return res.status(400).json({ message: 'Invalid position or dimension values' });
    }

    const machine = await Machine.findByIdAndUpdate(
      id,
      { 
        position: { x: Math.max(0, x), y: Math.max(0, y) },
        dimensions: { 
          width: Math.max(50, width), 
          height: Math.max(50, height) 
        }
      },
      { new: true }
    ).select('position dimensions').lean();
    
    if (!machine) {
      return res.status(404).json({ message: 'Machine not found' });
    }
    
    res.json(machine);
  } catch (error) {
    console.error('Machine position update error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Delete machine (Admin only) - Optimized with transaction
router.delete('/:id', auth, adminAuth, async (req, res) => {
  const session = await mongoose.startSession();
  
  try {
    const { id } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid machine ID' });
    }

    await session.withTransaction(async () => {
      const machineId = new mongoose.Types.ObjectId(id);
      
      // Check if machine exists
      const machine = await Machine.findById(machineId).session(session);
      if (!machine) {
        throw new Error('Machine not found');
      }
      
      // Delete all related data in parallel
      await Promise.all([
        Sensor.deleteMany({ machineId }).session(session),
        ProductionRecord.deleteMany({ machineId }).session(session),
        SignalData.deleteMany({ machineId }).session(session),
        Machine.findByIdAndDelete(machineId).session(session)
      ]);
    });
    
    res.json({ message: 'Machine and all related data deleted successfully' });
  } catch (error) {
    console.error('Machine deletion error:', error);
    res.status(500).json({ 
      message: error.message === 'Machine not found' ? error.message : 'Server error', 
      error: error.message 
    });
  } finally {
    await session.endSession();
  }
});

module.exports = router;