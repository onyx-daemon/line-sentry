const express = require('express');
const Sensor = require('../models/Sensor');
const SensorPinMapping = require('../models/SensorPinMapping');
const { auth, adminAuth } = require('../middleware/auth');
const Machine = require('../models/Machine')

const router = express.Router();

// Get all sensors
router.get('/', auth, async (req, res) => {
  try {
    const sensors = await Sensor.find({ isActive: true }).populate('machineId');
    res.json(sensors);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Add this new endpoint for paginated sensors
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

    // Convert page and limit to numbers
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    // Build the base query
    let query = {};

    // Text search across multiple fields
    if (search.trim()) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { sensorType: { $regex: search, $options: 'i' } }
      ];
    }

    // Filter by department
    if (department.trim()) {
      // We need to get the machine IDs that belong to this department
      const machinesInDepartment = await Machine.find({ departmentId: department }).select('_id');
      const machineIds = machinesInDepartment.map(m => m._id);
      query.machineId = { $in: machineIds };
    }

    // Filter by status
    if (status !== '') {
      query.isActive = status === 'true';
    }

    // Filter by sensor type
    if (sensorType.trim()) {
      query.sensorType = sensorType;
    }

    // Build sort object
    const sortObj = {};
    sortObj[sortBy] = sortOrder === 'asc' ? 1 : -1;

    // Execute query to get paginated results
    const sensorsQuery = Sensor.find(query)
      .populate({
        path: 'machineId',
        populate: { path: 'departmentId' }
      })
      .sort(sortObj)
      .skip(skip)
      .limit(limitNum);

    const totalSensorsQuery = Sensor.countDocuments(query);

    const [sensors, totalSensors] = await Promise.all([sensorsQuery, totalSensorsQuery]);

    // Calculate pagination info
    const totalPages = Math.ceil(totalSensors / limitNum);
    const hasNextPage = pageNum < totalPages;
    const hasPrevPage = pageNum > 1;

    res.json({
      sensors,
      pagination: {
        currentPage: pageNum,
        totalPages,
        totalSensors,
        limit: limitNum,
        hasNextPage,
        hasPrevPage,
        nextPage: hasNextPage ? pageNum + 1 : null,
        prevPage: hasPrevPage ? pageNum - 1 : null
      },
      filters: {
        search,
        department,
        status,
        sensorType,
        sortBy,
        sortOrder
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get sensors by machine
router.get('/machine/:machineId', auth, async (req, res) => {
  try {
    const sensors = await Sensor.find({ 
      machineId: req.params.machineId, 
      isActive: true 
    }).populate('machineId');
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

router.delete('/:id', auth, adminAuth, async (req, res) => {
  try {
    // Delete any pin mappings first
    await SensorPinMapping.deleteMany({ sensorId: req.params.id });
    
    // Then hard delete the sensor
    const sensor = await Sensor.findByIdAndDelete(req.params.id);
    
    if (!sensor) {
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
    
    // Check if pin is already occupied
    const existingMapping = await SensorPinMapping.findOne({ pinId });
    if (existingMapping) {
      return res.status(400).json({ message: 'Pin is already occupied' });
    }

    // Check if sensor is already mapped
    const existingSensorMapping = await SensorPinMapping.findOne({ sensorId });
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

// Get pin mappings
router.get('/pin-mappings', auth, adminAuth, async (req, res) => {
  try {
    const mappings = await SensorPinMapping.find({})
      .populate({
        path: 'sensorId',
        populate: { path: 'machineId' }  // Populate machineId for sensor
      });
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