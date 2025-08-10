const express = require('express');
const mongoose = require('mongoose');
const Sensor = require('../models/Sensor');
const SensorPinMapping = require('../models/SensorPinMapping');
const Machine = require('../models/Machine');
const { auth, adminAuth } = require('../middleware/auth');

const router = express.Router();

// Get all sensors - Optimized
router.get('/', auth, async (req, res) => {
  try {
    const sensors = await Sensor.find({ isActive: true })
      .populate({
        path: 'machineId',
        select: 'name departmentId',
        populate: {
          path: 'departmentId',
          select: 'name'
        }
      })
      .select('-__v')
      .lean();
      
    res.json(sensors);
  } catch (error) {
    console.error('Sensors fetch error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get paginated sensors for admin - Optimized
router.get('/admin/all', auth, adminAuth, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      search = '',
      department = '',
      status = '',
      sensorType = '',
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
        { description: { $regex: search, $options: 'i' } },
        { sensorType: { $regex: search, $options: 'i' } }
      ];
    }
    if (status !== '') {
      matchStage.isActive = status === 'true';
    }
    if (sensorType.trim()) {
      matchStage.sensorType = sensorType;
    }

    if (Object.keys(matchStage).length > 0) {
      pipeline.push({ $match: matchStage });
    }

    // Lookup machine and department info
    pipeline.push({
      $lookup: {
        from: 'machines',
        localField: 'machineId',
        foreignField: '_id',
        as: 'machineId',
        pipeline: [
          {
            $lookup: {
              from: 'departments',
              localField: 'departmentId',
              foreignField: '_id',
              as: 'departmentId',
              pipeline: [{ $project: { name: 1 } }]
            }
          },
          {
            $unwind: { path: '$departmentId', preserveNullAndEmptyArrays: true }
          },
          { $project: { name: 1, departmentId: 1 } }
        ]
      }
    });

    pipeline.push({
      $unwind: { path: '$machineId', preserveNullAndEmptyArrays: true }
    });

    // Filter by department if specified
    if (department.trim()) {
      pipeline.push({
        $match: { 'machineId.departmentId._id': new mongoose.Types.ObjectId(department) }
      });
    }

    // Remove __v field
    pipeline.push({ $project: { __v: 0 } });

    // Sort stage
    const sortObj = {};
    sortObj[sortBy] = sortOrder === 'asc' ? 1 : -1;
    pipeline.push({ $sort: sortObj });

    // Get total count
    const countPipeline = [...pipeline, { $count: 'total' }];
    const [countResult] = await Sensor.aggregate(countPipeline);
    const totalSensors = countResult?.total || 0;

    // Add pagination
    pipeline.push({ $skip: skip }, { $limit: limitNum });

    // Execute main query
    const sensors = await Sensor.aggregate(pipeline);

    // Calculate pagination info
    const totalPages = Math.ceil(totalSensors / limitNum);

    res.json({
      sensors,
      pagination: {
        currentPage: pageNum,
        totalPages,
        totalSensors,
        limit: limitNum,
        hasNextPage: pageNum < totalPages,
        hasPrevPage: pageNum > 1,
        nextPage: pageNum < totalPages ? pageNum + 1 : null,
        prevPage: pageNum > 1 ? pageNum - 1 : null
      },
      filters: { search, department, status, sensorType, sortBy, sortOrder }
    });
  } catch (error) {
    console.error('Admin sensors fetch error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get sensors by machine - Optimized
router.get('/machine/:machineId', auth, async (req, res) => {
  try {
    const { machineId } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(machineId)) {
      return res.status(400).json({ message: 'Invalid machine ID' });
    }

    const sensors = await Sensor.find({ 
      machineId: new mongoose.Types.ObjectId(machineId), 
      isActive: true 
    })
    .populate('machineId', 'name')
    .select('-__v')
    .lean();
    
    res.json(sensors);
  } catch (error) {
    console.error('Machine sensors fetch error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Create sensor (Admin only) - Optimized
router.post('/', auth, adminAuth, async (req, res) => {
  try {
    const { name, description, machineId, sensorType } = req.body;
    
    if (!name || !machineId || !sensorType) {
      return res.status(400).json({ message: 'Name, machine ID, and sensor type are required' });
    }

    if (!mongoose.Types.ObjectId.isValid(machineId)) {
      return res.status(400).json({ message: 'Invalid machine ID' });
    }

    // Check if machine exists
    const machineExists = await Machine.findById(machineId).select('_id').lean();
    if (!machineExists) {
      return res.status(400).json({ message: 'Machine not found' });
    }

    // Check for duplicate sensor name on same machine
    const existingSensor = await Sensor.findOne({
      name: { $regex: `^${name.trim()}$`, $options: 'i' },
      machineId: new mongoose.Types.ObjectId(machineId)
    }).select('_id').lean();

    if (existingSensor) {
      return res.status(400).json({ message: 'Sensor name already exists for this machine' });
    }

    const sensor = new Sensor({
      name: name.trim(),
      description: description?.trim() || '',
      machineId: new mongoose.Types.ObjectId(machineId),
      sensorType
    });
    
    await sensor.save();
    await sensor.populate('machineId', 'name');
    
    res.status(201).json(sensor);
  } catch (error) {
    console.error('Sensor creation error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Update sensor (Admin only) - Optimized
router.put('/:id', auth, adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, machineId, sensorType, isActive } = req.body;
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid sensor ID' });
    }

    // Build update object
    const updateData = {};
    if (name !== undefined) updateData.name = name.trim();
    if (description !== undefined) updateData.description = description?.trim() || '';
    if (sensorType !== undefined) updateData.sensorType = sensorType;
    if (isActive !== undefined) updateData.isActive = isActive;
    
    if (machineId !== undefined) {
      if (!mongoose.Types.ObjectId.isValid(machineId)) {
        return res.status(400).json({ message: 'Invalid machine ID' });
      }
      updateData.machineId = new mongoose.Types.ObjectId(machineId);
    }

    // Check for duplicate name if name is being updated
    if (name) {
      const duplicateQuery = {
        name: { $regex: `^${name.trim()}$`, $options: 'i' },
        machineId: updateData.machineId || req.body.machineId,
        _id: { $ne: id }
      };
      
      const existingSensor = await Sensor.findOne(duplicateQuery).select('_id').lean();
      if (existingSensor) {
        return res.status(400).json({ message: 'Sensor name already exists for this machine' });
      }
    }

    const sensor = await Sensor.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    )
    .populate({
      path: 'machineId',
      select: 'name departmentId',
      populate: {
        path: 'departmentId',
        select: 'name'
      }
    });
    
    if (!sensor) {
      return res.status(404).json({ message: 'Sensor not found' });
    }
    
    res.json(sensor);
  } catch (error) {
    console.error('Sensor update error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Delete sensor (Admin only) - Optimized with transaction
router.delete('/:id', auth, adminAuth, async (req, res) => {
  const session = await mongoose.startSession();
  
  try {
    const { id } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid sensor ID' });
    }

    await session.withTransaction(async () => {
      // Delete pin mappings and sensor in parallel
      await Promise.all([
        SensorPinMapping.deleteMany({ sensorId: new mongoose.Types.ObjectId(id) }).session(session),
        Sensor.findByIdAndDelete(id).session(session)
      ]);
    });
    
    res.json({ message: 'Sensor permanently deleted' });
  } catch (error) {
    console.error('Sensor deletion error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  } finally {
    await session.endSession();
  }
});

// Map sensor to pin (Admin only) - Optimized
router.post('/pin-mapping', auth, adminAuth, async (req, res) => {
  try {
    const { sensorId, pinId } = req.body;
    
    if (!sensorId || !pinId) {
      return res.status(400).json({ message: 'Sensor ID and Pin ID are required' });
    }

    if (!mongoose.Types.ObjectId.isValid(sensorId)) {
      return res.status(400).json({ message: 'Invalid sensor ID' });
    }

    // Check for existing mappings in parallel
    const [existingPinMapping, existingSensorMapping] = await Promise.all([
      SensorPinMapping.findOne({ pinId }).select('_id').lean(),
      SensorPinMapping.findOne({ sensorId: new mongoose.Types.ObjectId(sensorId) }).select('_id').lean()
    ]);

    if (existingPinMapping) {
      return res.status(400).json({ message: 'Pin is already occupied' });
    }

    if (existingSensorMapping) {
      return res.status(400).json({ message: 'Sensor is already mapped to a pin' });
    }

    const mapping = new SensorPinMapping({ 
      sensorId: new mongoose.Types.ObjectId(sensorId), 
      pinId 
    });
    
    await mapping.save();
    res.status(201).json(mapping);
  } catch (error) {
    console.error('Pin mapping creation error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get pin mappings - Optimized
router.get('/pin-mappings', auth, adminAuth, async (req, res) => {
  try {
    const mappings = await SensorPinMapping.find({})
      .populate({
        path: 'sensorId',
        select: 'name sensorType machineId',
        populate: {
          path: 'machineId',
          select: 'name departmentId',
          populate: {
            path: 'departmentId',
            select: 'name'
          }
        }
      })
      .select('-__v')
      .lean();
      
    res.json(mappings);
  } catch (error) {
    console.error('Pin mappings fetch error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Delete pin mapping (Admin only) - Optimized
router.delete('/pin-mapping/:id', auth, adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid mapping ID' });
    }
    
    const mapping = await SensorPinMapping.findByIdAndDelete(id).select('pinId').lean();
    
    if (!mapping) {
      return res.status(404).json({ message: 'Pin mapping not found' });
    }
    
    res.json({ message: 'Pin mapping permanently deleted' });
  } catch (error) {
    console.error('Pin mapping deletion error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;