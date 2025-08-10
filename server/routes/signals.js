const express = require('express');
const mongoose = require('mongoose');
const SignalData = require('../models/SignalData');
const SensorPinMapping = require('../models/SensorPinMapping');
const ProductionRecord = require('../models/ProductionRecord');
const Config = require('../models/Config');
const Machine = require('../models/Machine');
const { auth } = require('../middleware/auth');

const router = express.Router();

// In-memory state management for better performance
const machineLastActivity = new Map();
const machineLastCycleSignal = new Map();
const machineLastPowerSignal = new Map();
const machineStates = new Map();
const pendingStoppages = new Map();
const machineRunningMinutes = new Map();
const unclassifiedStoppages = new Map();

// Cache for pin mappings to avoid repeated DB queries
let pinMappingsCache = null;
let pinMappingsCacheTime = 0;
const CACHE_DURATION = 60000; // 1 minute

// Cache for configuration
let configCache = null;
let configCacheTime = 0;

// Get configuration with caching
const getSignalTimeouts = async () => {
  const now = Date.now();
  if (!configCache || (now - configCacheTime) > CACHE_DURATION) {
    try {
      configCache = await Config.findOne().select('signalTimeouts').lean();
      configCacheTime = now;
    } catch (error) {
      console.error('Error getting signal timeouts:', error);
    }
  }
  
  return {
    powerTimeout: (configCache?.signalTimeouts?.powerSignalTimeout || 5) * 60 * 1000,
    cycleTimeout: (configCache?.signalTimeouts?.cycleSignalTimeout || 2) * 60 * 1000
  };
};

// Get pin mappings with caching
const getPinMappings = async () => {
  const now = Date.now();
  if (!pinMappingsCache || (now - pinMappingsCacheTime) > CACHE_DURATION) {
    try {
      pinMappingsCache = await SensorPinMapping.find({})
        .populate({
          path: 'sensorId',
          select: 'sensorType machineId',
          populate: {
            path: 'machineId',
            select: '_id departmentId',
            populate: {
              path: 'departmentId',
              select: 'name'
            }
          }
        })
        .lean();
      pinMappingsCacheTime = now;
    } catch (error) {
      console.error('Error getting pin mappings:', error);
      pinMappingsCache = [];
    }
  }
  
  return pinMappingsCache || [];
};

// Process pin data from daemon - Optimized
router.post('/pin-data', async (req, res) => {
  try {
    const { pinData, timestamp } = req.body;
    const io = req.app.get('io');
    
    if (!pinData) {
      return res.status(400).json({ message: 'Pin data is required' });
    }

    const byteValue = parseInt(pinData, 16);
    const currentTime = new Date(timestamp || Date.now());
    
    // Get cached pin mappings and timeouts
    const [pinMappings, timeouts] = await Promise.all([
      getPinMappings(),
      getSignalTimeouts()
    ]);

    const processedMachines = new Set();
    const signalUpdates = [];

    // Process each pin efficiently
    for (let pinIndex = 0; pinIndex < 8; pinIndex++) {
      const pinId = `DQ.${pinIndex}`;
      const pinValue = (byteValue >> pinIndex) & 1;
      
      const mapping = pinMappings.find(m => m.pinId === pinId);
      if (!mapping?.sensorId?.machineId) continue;

      const sensor = mapping.sensorId;
      const machine = sensor.machineId;
      
      // Batch signal updates for bulk operation
      signalUpdates.push({
        updateOne: {
          filter: { sensorId: sensor._id },
          update: { 
            machineId: machine._id,
            value: pinValue,
            timestamp: currentTime
          },
          upsert: true
        }
      });

      // Process power signals
      if (sensor.sensorType === 'power' && pinValue === 1) {
        machineLastPowerSignal.set(machine._id.toString(), currentTime);
        
        io.emit('power-signal', {
          machineId: machine._id.toString(),
          value: pinValue,
          timestamp: currentTime
        });
      }

      // Process unit cycle signals
      if (sensor.sensorType === 'unit-cycle' && pinValue === 1) {
        await updateProductionRecord(machine._id, currentTime, io);
        processedMachines.add(machine._id.toString());
        
        machineLastCycleSignal.set(machine._id.toString(), currentTime);
        
        // Clear pending stoppages
        if (pendingStoppages.has(machine._id.toString())) {
          await resolvePendingStoppage(machine._id.toString(), currentTime, io);
          pendingStoppages.delete(machine._id.toString());
        }
      }

      machineLastActivity.set(machine._id.toString(), currentTime);
    }

    // Bulk update signal data
    if (signalUpdates.length > 0) {
      await SignalData.bulkWrite(signalUpdates);
    }

    // Update machine states
    await updateMachineStates(pinMappings, currentTime, io, timeouts);

    res.json({ 
      message: 'Pin data processed successfully',
      processedMachines: Array.from(processedMachines)
    });

  } catch (error) {
    console.error('Error processing pin data:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Update machine states - Optimized
async function updateMachineStates(pinMappings, currentTime, io, timeouts) {
  const machinesWithSensors = new Set();
  const machineUpdates = [];
  
  pinMappings.forEach(mapping => {
    if (mapping.sensorId?.machineId) {
      machinesWithSensors.add(mapping.sensorId.machineId._id.toString());
    }
  });

  for (const machineId of machinesWithSensors) {
    const lastPowerTime = machineLastPowerSignal.get(machineId);
    const lastCycleTime = machineLastCycleSignal.get(machineId);
    
    const powerTimeoutAgo = new Date(currentTime.getTime() - timeouts.powerTimeout);
    const cycleTimeoutAgo = new Date(currentTime.getTime() - timeouts.cycleTimeout);
    
    const hasPower = lastPowerTime && lastPowerTime >= powerTimeoutAgo;
    const hasCycle = lastCycleTime && lastCycleTime >= cycleTimeoutAgo;
    
    let machineStatus, statusColor;
    
    if (hasPower && hasCycle) {
      machineStatus = 'running';
      statusColor = 'green';
      
      const currentMinute = Math.floor(currentTime.getTime() / (60 * 1000));
      const lastTrackedMinute = machineRunningMinutes.get(machineId) || 0;
      
      if (currentMinute > lastTrackedMinute) {
        machineRunningMinutes.set(machineId, currentMinute);
        await updateRunningMinutes(machineId, currentTime, io);
      }
      
    } else if (hasPower && !hasCycle) {
      machineStatus = 'stoppage';
      statusColor = 'red';
      
      if (!pendingStoppages.has(machineId)) {
        await createPendingStoppage(machineId, currentTime, io);
        pendingStoppages.set(machineId, {
          startTime: currentTime,
          detectedAt: currentTime
        });
      }
      
    } else if (!hasPower && hasCycle) {
      machineStatus = 'stopped_yet_producing';
      statusColor = 'orange';
      
    } else {
      machineStatus = 'inactive';
      statusColor = 'gray';
    }

    // Update machine state in memory
    machineStates.set(machineId, {
      status: machineStatus,
      color: statusColor,
      hasPower,
      hasCycle,
      lastUpdate: currentTime
    });

    // Batch machine status updates
    machineUpdates.push({
      updateOne: {
        filter: { _id: new mongoose.Types.ObjectId(machineId) },
        update: { status: machineStatus }
      }
    });

    // Emit real-time update
    io.emit('machine-state-update', {
      machineId,
      status: machineStatus,
      color: statusColor,
      hasPower,
      hasCycle,
      dbStatus: machineStatus,
      timestamp: currentTime
    });
  }

  // Bulk update machine statuses
  if (machineUpdates.length > 0) {
    try {
      await Machine.bulkWrite(machineUpdates);
    } catch (error) {
      console.error('Error bulk updating machine statuses:', error);
    }
  }
}

// Update running minutes - Optimized
async function updateRunningMinutes(machineId, currentTime, io) {
  try {
    const currentHour = currentTime.getHours();
    const currentDate = currentTime.toISOString().split('T')[0];
    
    // Use upsert for better performance
    const result = await ProductionRecord.findOneAndUpdate(
      {
        machineId: new mongoose.Types.ObjectId(machineId),
        startTime: {
          $gte: new Date(currentDate + 'T00:00:00.000Z'),
          $lt: new Date(currentDate + 'T23:59:59.999Z')
        }
      },
      {
        $setOnInsert: {
          machineId: new mongoose.Types.ObjectId(machineId),
          startTime: new Date(currentDate + 'T00:00:00.000Z'),
          hourlyData: []
        }
      },
      { upsert: true, new: true }
    );

    // Find or create hourly data
    let hourData = result.hourlyData.find(h => h.hour === currentHour);
    if (!hourData) {
      hourData = {
        hour: currentHour,
        unitsProduced: 0,
        defectiveUnits: 0,
        status: 'running',
        runningMinutes: 0,
        stoppageMinutes: 0,
        stoppages: []
      };
      result.hourlyData.push(hourData);
    }

    // Increment running minutes (cap at 60)
    hourData.runningMinutes = Math.min(60, (hourData.runningMinutes || 0) + 1);
    hourData.status = 'running';
    
    result.markModified('hourlyData');
    await result.save();

    // Emit update
    io.emit('running-time-update', {
      machineId: machineId.toString(),
      hour: currentHour,
      date: currentDate,
      runningMinutes: hourData.runningMinutes,
      timestamp: currentTime
    });

  } catch (error) {
    console.error('Error updating running minutes:', error);
  }
}

// Create pending stoppage - Optimized
async function createPendingStoppage(machineId, currentTime, io) {
  try {
    const currentHour = currentTime.getHours();
    const currentDate = currentTime.toISOString().split('T')[0];
    
    // Use upsert for production record
    const result = await ProductionRecord.findOneAndUpdate(
      {
        machineId: new mongoose.Types.ObjectId(machineId),
        startTime: {
          $gte: new Date(currentDate + 'T00:00:00.000Z'),
          $lt: new Date(currentDate + 'T23:59:59.999Z')
        }
      },
      {
        $setOnInsert: {
          machineId: new mongoose.Types.ObjectId(machineId),
          startTime: new Date(currentDate + 'T00:00:00.000Z'),
          hourlyData: []
        }
      },
      { upsert: true, new: true }
    );

    // Find or create hourly data
    let hourData = result.hourlyData.find(h => h.hour === currentHour);
    if (!hourData) {
      hourData = {
        hour: currentHour,
        unitsProduced: 0,
        defectiveUnits: 0,
        status: 'stoppage',
        runningMinutes: 0,
        stoppageMinutes: 0,
        stoppages: []
      };
      result.hourlyData.push(hourData);
    }

    // Check if unclassified stoppage already exists
    const existingUnclassified = hourData.stoppages.find(s => 
      s.reason === 'unclassified' && s.isPending
    );
    
    if (!existingUnclassified) {
      const newStoppage = {
        _id: new mongoose.Types.ObjectId(),
        reason: 'unclassified',
        description: 'Automatic stoppage detection - awaiting categorization',
        startTime: currentTime,
        endTime: null,
        duration: 0,
        isPending: true,
        isClassified: false
      };

      hourData.stoppages.push(newStoppage);
      hourData.status = 'stoppage';
      
      result.markModified('hourlyData');
      await result.save();
      
      // Store in memory for tracking
      unclassifiedStoppages.set(machineId, {
        id: newStoppage._id.toString(),
        startTime: currentTime,
        hour: currentHour,
        date: currentDate
      });

      // Emit socket event
      io.emit('unclassified-stoppage-detected', {
        machineId: machineId.toString(),
        hour: currentHour,
        date: currentDate,
        stoppageStart: currentTime,
        pendingStoppageId: newStoppage._id.toString(),
        timestamp: currentTime
      });
    }

  } catch (error) {
    console.error('Error creating pending stoppage:', error);
  }
}

// Resolve pending stoppage - Optimized
async function resolvePendingStoppage(machineId, currentTime, io) {
  try {
    const currentHour = currentTime.getHours();
    const currentDate = currentTime.toISOString().split('T')[0];
    
    const result = await ProductionRecord.findOneAndUpdate(
      {
        machineId: new mongoose.Types.ObjectId(machineId),
        startTime: {
          $gte: new Date(currentDate + 'T00:00:00.000Z'),
          $lt: new Date(currentDate + 'T23:59:59.999Z')
        },
        'hourlyData.hour': currentHour
      },
      {
        $pull: { 'hourlyData.$.stoppages': { reason: 'unclassified' } },
        $set: { 'hourlyData.$.status': 'running' }
      }
    );

    if (result) {
      unclassifiedStoppages.delete(machineId);
      
      io.emit('stoppage-resolved', {
        machineId: machineId.toString(),
        timestamp: currentTime
      });
    }

  } catch (error) {
    console.error('Error resolving pending stoppage:', error);
  }
}

// Update ongoing stoppages - Optimized with bulk operations
async function updateOngoingStoppages(currentTime, io) {
  try {
    const bulkOps = [];
    
    for (const [machineId, stoppageInfo] of unclassifiedStoppages) {
      const { id, startTime, hour, date } = stoppageInfo;
      const duration = Math.min(60, Math.floor((currentTime - startTime) / 60000));
      
      bulkOps.push({
        updateOne: {
          filter: {
            machineId: new mongoose.Types.ObjectId(machineId),
            startTime: { 
              $gte: new Date(date + 'T00:00:00.000Z'), 
              $lt: new Date(date + 'T23:59:59.999Z') 
            },
            'hourlyData.hour': hour,
            'hourlyData.stoppages._id': new mongoose.Types.ObjectId(id)
          },
          update: {
            $set: {
              'hourlyData.$.stoppages.$[stoppage].duration': duration,
              'hourlyData.$.stoppageMinutes': duration
            }
          },
          arrayFilters: [{ 'stoppage._id': new mongoose.Types.ObjectId(id) }]
        }
      });
    }

    if (bulkOps.length > 0) {
      await ProductionRecord.bulkWrite(bulkOps);
      
      // Emit updates
      for (const [machineId, stoppageInfo] of unclassifiedStoppages) {
        const duration = Math.min(60, Math.floor((currentTime - stoppageInfo.startTime) / 60000));
        
        io.emit('stoppage-updated', {
          machineId,
          hour: stoppageInfo.hour,
          date: stoppageInfo.date,
          stoppageId: stoppageInfo.id,
          duration
        });
      }
    }
  } catch (error) {
    console.error('Error updating ongoing stoppages:', error);
  }
}

// Set up periodic stoppage updates
setInterval(() => {
  updateOngoingStoppages(new Date(), global.io);
}, 60000);

// Get unclassified stoppages count - Optimized
router.get('/unclassified-stoppages-count', async (req, res) => {
  try {
    const [result] = await ProductionRecord.aggregate([
      { $unwind: '$hourlyData' },
      { $unwind: '$hourlyData.stoppages' },
      { $match: { 'hourlyData.stoppages.reason': 'unclassified' } },
      { $count: 'total' }
    ]);
    
    res.json({ count: result?.total || 0 });
  } catch (error) {
    console.error('Unclassified stoppages count error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Update production record - Optimized
async function updateProductionRecord(machineId, currentTime, io) {
  try {
    const currentHour = currentTime.getHours();
    const currentDate = currentTime.toISOString().split('T')[0];
    
    // Use findOneAndUpdate with upsert for better performance
    const result = await ProductionRecord.findOneAndUpdate(
      {
        machineId: new mongoose.Types.ObjectId(machineId),
        startTime: {
          $gte: new Date(currentDate + 'T00:00:00.000Z'),
          $lt: new Date(currentDate + 'T23:59:59.999Z')
        }
      },
      {
        $setOnInsert: {
          machineId: new mongoose.Types.ObjectId(machineId),
          startTime: new Date(currentDate + 'T00:00:00.000Z'),
          hourlyData: [],
          lastActivityTime: currentTime
        },
        $set: { lastActivityTime: currentTime }
      },
      { upsert: true, new: true }
    );

    // Find or create hourly data
    let hourData = result.hourlyData.find(h => h.hour === currentHour);
    if (!hourData) {
      hourData = {
        hour: currentHour,
        unitsProduced: 1,
        defectiveUnits: 0,
        status: 'running',
        runningMinutes: 0,
        stoppageMinutes: 0,
        stoppages: []
      };
      result.hourlyData.push(hourData);
    } else {
      hourData.unitsProduced += 1;
    }

    hourData.status = 'running';

    // Update total units efficiently
    result.unitsProduced = result.hourlyData.reduce((sum, h) => sum + h.unitsProduced, 0);
    
    result.markModified('hourlyData');
    await result.save();

    // Emit socket event
    io.emit('production-update', {
      machineId: machineId.toString(),
      hour: currentHour,
      date: currentDate,
      unitsProduced: hourData.unitsProduced,
      status: hourData.status,
      runningMinutes: hourData.runningMinutes,
      stoppageMinutes: hourData.stoppageMinutes,
      timestamp: currentTime
    });

  } catch (error) {
    console.error('Error updating production record:', error);
  }
}

// Get recent signals for a machine - Optimized
router.get('/machine/:machineId/recent', auth, async (req, res) => {
  try {
    const { machineId } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(machineId)) {
      return res.status(400).json({ message: 'Invalid machine ID' });
    }
    
    const signals = await SignalData.find({ 
      machineId: new mongoose.Types.ObjectId(machineId) 
    })
    .populate('sensorId', 'name sensorType')
    .select('-__v')
    .lean();

    res.json(signals);
  } catch (error) {
    console.error('Recent signals fetch error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Add/update signal data - Optimized
router.post('/', async (req, res) => {
  try {
    const { sensorId, machineId, value, timestamp } = req.body;
    
    if (!sensorId || !machineId) {
      return res.status(400).json({ message: 'Sensor ID and Machine ID are required' });
    }

    if (!mongoose.Types.ObjectId.isValid(sensorId) || !mongoose.Types.ObjectId.isValid(machineId)) {
      return res.status(400).json({ message: 'Invalid sensor or machine ID' });
    }
    
    await SignalData.findOneAndUpdate(
      { sensorId: new mongoose.Types.ObjectId(sensorId) },
      { 
        machineId: new mongoose.Types.ObjectId(machineId),
        value,
        timestamp: timestamp ? new Date(timestamp) : new Date()
      },
      { upsert: true }
    );

    res.status(201).json({ message: 'Signal data updated successfully' });
  } catch (error) {
    console.error('Signal data update error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;