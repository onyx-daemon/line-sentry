const express = require('express');
const Sensor = require('../models/Sensor');
const SensorPinMapping = require('../models/SensorPinMapping');
const { auth, adminAuth } = require('../middleware/auth');
const Machine = require('../models/Machine');

const router = express.Router();

// Get all sensors (optimized)
router.get('/', auth, async (req, res) => {
  try {
    const sensors = await Sensor.find({ isActive: true })
      .populate('machineId', 'name _id')
      .lean();
    
    res.json(sensors);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get paginated sensors for admin (optimized with aggregation)
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
        { description: { $regex: search, $options: 'i' } },
        { sensorType: { $regex: search, $options: 'i' } }
      ];
    }
    if (status !== '') matchStage.isActive = status === 'true';
    if (sensorType.trim()) matchStage.sensorType = sensorType;

    // Department filter requires machine lookup
    if (department.trim()) {
      pipeline.push({
        $lookup: {
          from: 'machines',
          localField: 'machineId',
          foreignField: '_id',
          as: 'machine'
        }
      });
      
      pipeline.push({
        $match: {
          'machine.departmentId': new mongoose.Types.ObjectId(department)
        }
      });
    }

    if (Object.keys(matchStage).length > 0) {
      pipeline.push({ $match: matchStage });
    }

    // Populate machine and department info
    if (!department.trim()) {
      pipeline.push({
        $lookup: {
          from: 'machines',
          localField: 'machineId',
          foreignField: '_id',
          as: 'machine'
        }
      });
    }

    pipeline.push({
      $lookup: {
        from: 'departments',
        localField: 'machine.departmentId',
        foreignField: '_id',
        as: 'department'
      }
    });

    pipeline.push({
      $addFields: {
        machineId: {
          _id: { $arrayElemAt: ['$machine._id', 0] },
          name: { $arrayElemAt: ['$machine.name', 0] },
          departmentId: {
            _id: { $arrayElemAt: ['$department._id', 0] },
            name: { $arrayElemAt: ['$department.name', 0] }
          }
        }
      }
    });

    pipeline.push({
      $project: {
        machine: 0,
        department: 0
      }
    });

    // Sort stage
    const sortObj = {};
    sortObj[sortBy] = sortOrder === 'asc' ? 1 : -1;
    pipeline.push({ $sort: sortObj });

    // Get total count and paginated results
    const countPipeline = [...pipeline, { $count: 'total' }];
    const [sensors, countResult] = await Promise.all([
      Sensor.aggregate([
        ...pipeline,
        { $skip: skip },
        { $limit: limitNum }
      ]),
      Sensor.aggregate(countPipeline)
    ]);

    const totalSensors = countResult[0]?.total || 0;
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
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get sensors by machine (optimized)
router.get('/machine/:machineId', auth, async (req, res) => {
  try {
    const sensors = await Sensor.find({ 
      machineId: req.params.machineId, 
      isActive: true 
    })
    .populate('machineId', 'name _id')
    .lean();
    
    res.json(sensors);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Create sensor (Admin only)
router.post('/', auth, adminAuth, async (req, res) => {
  try {
    const sensor = new Sensor(req.body);
    await sensor.save();
    res.status(201).json(sensor);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Update sensor (Admin only)
router.put('/:id', auth, adminAuth, async (req, res) => {
  try {
    const sensor = await Sensor.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true }
    ).populate('machineId');
    
    if (!sensor) {
      return res.status(404).json({ message: 'Sensor not found' });
    }
    
    res.json(sensor);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Delete sensor (optimized with batch operations)
router.delete('/:id', auth, adminAuth, async (req, res) => {
  try {
    // Batch delete sensor and its mappings
    const [deletedMappings, deletedSensor] = await Promise.all([
      SensorPinMapping.deleteMany({ sensorId: req.params.id }),
      Sensor.findByIdAndDelete(req.params.id)
    ]);
    
    if (!deletedSensor) {
      return res.status(404).json({ message: 'Sensor not found' });
    }
    
    res.json({ message: 'Sensor permanently deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Map sensor to pin (Admin only)
router.post('/pin-mapping', auth, adminAuth, async (req, res) => {
  try {
    const { sensorId, pinId } = req.body;
    
    // Check constraints with single query
    const [existingPinMapping, existingSensorMapping] = await Promise.all([
      SensorPinMapping.findOne({ pinId }).lean(),
      SensorPinMapping.findOne({ sensorId }).lean()
    ]);
    
    if (existingPinMapping) {
      return res.status(400).json({ message: 'Pin is already occupied' });
    }

    if (existingSensorMapping) {
      return res.status(400).json({ message: 'Sensor is already mapped to a pin' });
    }

    const mapping = new SensorPinMapping({ sensorId, pinId });
    await mapping.save();
    
    res.status(201).json(mapping);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get pin mappings (optimized with aggregation)
router.get('/pin-mappings', auth, adminAuth, async (req, res) => {
  try {
    const mappings = await SensorPinMapping.aggregate([
      {
        $lookup: {
          from: 'sensors',
          localField: 'sensorId',
          foreignField: '_id',
          as: 'sensor'
        }
      },
      {
        $lookup: {
          from: 'machines',
          localField: 'sensor.machineId',
          foreignField: '_id',
          as: 'machine'
        }
      },
      {
        $addFields: {
          sensorId: {
            _id: { $arrayElemAt: ['$sensor._id', 0] },
            name: { $arrayElemAt: ['$sensor.name', 0] },
            sensorType: { $arrayElemAt: ['$sensor.sensorType', 0] },
            machineId: {
              _id: { $arrayElemAt: ['$machine._id', 0] },
              name: { $arrayElemAt: ['$machine.name', 0] }
            }
          }
        }
      },
      {
        $project: {
          sensor: 0,
          machine: 0
        }
      }
    ]);
    
    res.json(mappings);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Delete pin mapping (Admin only)
router.delete('/pin-mapping/:id', auth, adminAuth, async (req, res) => {
  try {
    const mapping = await SensorPinMapping.findByIdAndDelete(req.params.id);
    
    if (!mapping) {
      return res.status(404).json({ message: 'Pin mapping not found' });
    }
    
    res.json({ message: 'Pin mapping permanently deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;