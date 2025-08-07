const express = require('express');
const mongoose = require('mongoose');
const SignalData = require('../models/SignalData');
const SensorPinMapping = require('../models/SensorPinMapping');
const ProductionRecord = require('../models/ProductionRecord');
const Config = require('../models/Config');
const { auth } = require('../middleware/auth');
const Machine = require('../models/Machine');
const cacheManager = require('../utils/cache');
const AggregationHelper = require('../utils/aggregations');

const router = express.Router();

// In-memory state management for real-time performance
const machineLastActivity = new Map();
const machineLastCycleSignal = new Map();
const machineLastPowerSignal = new Map();
const machineStates = new Map();
const pendingStoppages = new Map();
const machineRunningMinutes = new Map();
const unclassifiedStoppages = new Map();

// Cache pin mappings for better performance
let cachedPinMappings = null;
let pinMappingsCacheTime = 0;
const PIN_MAPPINGS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function getCachedPinMappings() {
  const now = Date.now();
  
  if (!cachedPinMappings || (now - pinMappingsCacheTime) > PIN_MAPPINGS_CACHE_TTL) {
    cachedPinMappings = await SensorPinMapping.find({})
      .populate({
        path: 'sensorId',
        populate: {
          path: 'machineId',
          populate: {
            path: 'departmentId'
          }
        }
      })
      .lean();
    
    pinMappingsCacheTime = now;
  }
  
  return cachedPinMappings;
}

// Get configuration for timeouts (optimized with caching)
const getSignalTimeouts = async () => {
  try {
    let config = cacheManager.getConfig();
    
    if (!config) {
      config = await Config.findOne().lean();
      if (config) {
        cacheManager.setConfig(config);
      }
    }
    
    return {
      powerTimeout: (config?.signalTimeouts?.powerSignalTimeout || 5) * 60 * 1000,
      cycleTimeout: (config?.signalTimeouts?.cycleSignalTimeout || 2) * 60 * 1000
    };
  } catch (error) {
    console.error('Error getting signal timeouts:', error);
    return { powerTimeout: 5 * 60 * 1000, cycleTimeout: 2 * 60 * 1000 };
  }
};

// Process pin data from daemon (optimized)
router.post('/pin-data', async (req, res) => {
  try {
    const { pinData, timestamp } = req.body;
    const io = req.app.get('io');
    
    if (!pinData) {
      return res.status(400).json({ message: 'Pin data is required' });
    }

    const byteValue = parseInt(pinData, 16);
    const currentTime = new Date(timestamp || Date.now());
    
    console.log(`Received pin data: ${pinData} (${byteValue.toString(2).padStart(8, '0')})`);

    // Get cached pin mappings
    const pinMappings = await getCachedPinMappings();
    const processedMachines = new Set();
    const timeouts = await getSignalTimeouts();

    // Batch signal data updates
    const signalUpdates = [];

    // Process each pin
    for (let pinIndex = 0; pinIndex < 8; pinIndex++) {
      const pinId = `DQ.${pinIndex}`;
      const pinValue = (byteValue >> pinIndex) & 1;
      
      const mapping = pinMappings.find(m => m.pinId === pinId);
      if (!mapping || !mapping.sensorId) continue;

      const sensor = mapping.sensorId;
      const machine = sensor.machineId;
      
      if (!machine) continue;

      // Prepare signal update for batch operation
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
        await updateProductionRecordOptimized(machine._id, currentTime, io);
        processedMachines.add(machine._id.toString());
        
        machineLastCycleSignal.set(machine._id.toString(), currentTime);
        
        if (pendingStoppages.has(machine._id.toString())) {
          await resolvePendingStoppageOptimized(machine._id.toString(), currentTime, io);
          pendingStoppages.delete(machine._id.toString());
        }
      }
      
      machineLastActivity.set(machine._id.toString(), currentTime);
    }

    // Batch update signal data
    if (signalUpdates.length > 0) {
      await SignalData.bulkWrite(signalUpdates);
    }

    // Update machine states
    await updateMachineStatesOptimized(pinMappings, currentTime, io, timeouts);

    res.json({ 
      message: 'Pin data processed successfully',
      processedMachines: Array.from(processedMachines)
    });

  } catch (error) {
    console.error('Error processing pin data:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Optimized machine state updates
async function updateMachineStatesOptimized(pinMappings, currentTime, io, timeouts) {
  const machinesWithSensors = new Set();
  const machineUpdates = [];
  
  pinMappings.forEach(mapping => {
    if (mapping.sensorId && mapping.sensorId.machineId) {
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
    
    let machineStatus;
    let statusColor;
    
    if (hasPower && hasCycle) {
      machineStatus = 'running';
      statusColor = 'green';
      
      const currentMinute = Math.floor(currentTime.getTime() / (60 * 1000));
      const lastTrackedMinute = machineRunningMinutes.get(machineId) || 0;
      
      if (currentMinute > lastTrackedMinute) {
        machineRunningMinutes.set(machineId, currentMinute);
        await updateRunningMinutesOptimized(machineId, currentTime, io);
      }
      
    } else if (hasPower && !hasCycle) {
      machineStatus = 'stoppage';
      statusColor = 'red';
      
      if (!pendingStoppages.has(machineId)) {
        await createPendingStoppageOptimized(machineId, currentTime, io);
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
    const currentState = machineStates.get(machineId) || {};
    const newState = {
      ...currentState,
      status: machineStatus,
      color: statusColor,
      hasPower,
      hasCycle,
      lastUpdate: currentTime
    };
    
    machineStates.set(machineId, newState);

    // Prepare batch update for database
    machineUpdates.push({
      updateOne: {
        filter: { _id: new mongoose.Types.ObjectId(machineId) },
        update: { status: machineStatus }
      }
    });

    // Emit machine state update
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

  // Batch update machine statuses
  if (machineUpdates.length > 0) {
    try {
      await Machine.bulkWrite(machineUpdates);
    } catch (error) {
      console.error('Error batch updating machine statuses:', error);
    }
  }
}

// Optimized running minutes update
async function updateRunningMinutesOptimized(machineId, currentTime, io) {
  try {
    const currentHour = currentTime.getHours();
    const currentDate = currentTime.toISOString().split('T')[0];
    
    // Use upsert for better performance
    const filter = {
      machineId,
      startTime: {
        $gte: new Date(currentDate + 'T00:00:00.000Z'),
        $lt: new Date(currentDate + 'T23:59:59.999Z')
      }
    };

    const update = {
      $setOnInsert: {
        machineId,
        startTime: new Date(currentDate + 'T00:00:00.000Z'),
        unitsProduced: 0,
        defectiveUnits: 0
      },
      $inc: {
        [`hourlyData.$[elem].runningMinutes`]: 1
      },
      $set: {
        [`hourlyData.$[elem].status`]: 'running'
      }
    };

    const arrayFilters = [{ 'elem.hour': currentHour }];

    let result = await ProductionRecord.findOneAndUpdate(
      filter,
      update,
      { 
        upsert: true, 
        new: true,
        arrayFilters
      }
    );

    // If hour doesn't exist, add it
    if (!result.hourlyData.find(h => h.hour === currentHour)) {
      await ProductionRecord.findOneAndUpdate(
        filter,
        {
          $push: {
            hourlyData: {
              hour: currentHour,
              unitsProduced: 0,
              defectiveUnits: 0,
              status: 'running',
              runningMinutes: 1,
              stoppageMinutes: 0,
              stoppages: []
            }
          }
        }
      );
    }

    // Invalidate cache for this machine
    cacheManager.invalidateMachineStats(machineId);

    // Emit running time update
    io.emit('running-time-update', {
      machineId: machineId.toString(),
      hour: currentHour,
      date: currentDate,
      runningMinutes: (result.hourlyData.find(h => h.hour === currentHour)?.runningMinutes || 0) + 1,
      timestamp: currentTime
    });

  } catch (error) {
    console.error('Error updating running minutes:', error);
  }
}

// Optimized pending stoppage creation
async function createPendingStoppageOptimized(machineId, currentTime, io) {
  try {
    const currentHour = currentTime.getHours();
    const currentDate = currentTime.toISOString().split('T')[0];
    
    const filter = {
      machineId,
      startTime: {
        $gte: new Date(currentDate + 'T00:00:00.000Z'),
        $lt: new Date(currentDate + 'T23:59:59.999Z')
      }
    };

    let productionRecord = await ProductionRecord.findOne(filter);

    if (!productionRecord) {
      productionRecord = new ProductionRecord({
        machineId,
        startTime: new Date(currentDate + 'T00:00:00.000Z'),
        hourlyData: []
      });
    }

    let hourData = productionRecord.hourlyData.find(h => h.hour === currentHour);
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
      productionRecord.hourlyData.push(hourData);
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
      
      await productionRecord.save();
      
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

// Optimized pending stoppage resolution
async function resolvePendingStoppageOptimized(machineId, currentTime, io) {
  try {
    const currentHour = currentTime.getHours();
    const currentDate = currentTime.toISOString().split('T')[0];
    
    // Use atomic update to remove pending stoppages
    await ProductionRecord.findOneAndUpdate(
      {
        machineId,
        startTime: {
          $gte: new Date(currentDate + 'T00:00:00.000Z'),
          $lt: new Date(currentDate + 'T23:59:59.999Z')
        },
        'hourlyData.hour': currentHour
      },
      {
        $pull: {
          'hourlyData.$.stoppages': { reason: 'unclassified' }
        },
        $set: {
          'hourlyData.$.status': 'running'
        }
      }
    );

    unclassifiedStoppages.delete(machineId);

    io.emit('stoppage-resolved', {
      machineId: machineId.toString(),
      timestamp: currentTime
    });

  } catch (error) {
    console.error('Error resolving pending stoppage:', error);
  }
}

// Optimized production record update
async function updateProductionRecordOptimized(machineId, currentTime, io) {
  try {
    const currentHour = currentTime.getHours();
    const currentDate = currentTime.toISOString().split('T')[0];
    
    // Use atomic increment for better performance
    const filter = {
      machineId,
      startTime: {
        $gte: new Date(currentDate + 'T00:00:00.000Z'),
        $lt: new Date(currentDate + 'T23:59:59.999Z')
      }
    };

    const update = {
      $inc: {
        unitsProduced: 1,
        [`hourlyData.$[elem].unitsProduced`]: 1
      },
      $set: {
        [`hourlyData.$[elem].status`]: 'running',
        lastActivityTime: currentTime
      },
      $setOnInsert: {
        machineId,
        startTime: new Date(currentDate + 'T00:00:00.000Z'),
        defectiveUnits: 0
      }
    };

    const arrayFilters = [{ 'elem.hour': currentHour }];

    let result = await ProductionRecord.findOneAndUpdate(
      filter,
      update,
      { 
        upsert: true, 
        new: true,
        arrayFilters
      }
    );

    // If hour doesn't exist, add it
    if (!result.hourlyData.find(h => h.hour === currentHour)) {
      await ProductionRecord.findOneAndUpdate(
        filter,
        {
          $push: {
            hourlyData: {
              hour: currentHour,
              unitsProduced: 1,
              defectiveUnits: 0,
              status: 'running',
              runningMinutes: 0,
              stoppageMinutes: 0,
              stoppages: []
            }
          }
        }
      );
      
      // Refetch to get updated data
      result = await ProductionRecord.findOne(filter);
    }

    const hourData = result.hourlyData.find(h => h.hour === currentHour);

    // Invalidate cache for this machine
    cacheManager.invalidateMachineStats(machineId);

    // Emit socket event
    io.emit('production-update', {
      machineId: machineId.toString(),
      hour: currentHour,
      date: currentDate,
      unitsProduced: hourData?.unitsProduced || 1,
      status: hourData?.status || 'running',
      runningMinutes: hourData?.runningMinutes || 0,
      stoppageMinutes: hourData?.stoppageMinutes || 0,
      timestamp: currentTime
    });

    console.log(`Updated production for machine ${machineId}: +1 unit (total: ${hourData?.unitsProduced || 1})`);

  } catch (error) {
    console.error('Error updating production record:', error);
  }
}

// Get unclassified stoppages count (optimized with aggregation)
router.get('/unclassified-stoppages-count', async (req, res) => {
  try {
    const aggregation = AggregationHelper.getUnclassifiedStoppagesCountAggregation();
    const result = await ProductionRecord.aggregate(aggregation);
    
    res.json({ count: result[0]?.total || 0 });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get recent signals for a machine (optimized)
router.get('/machine/:machineId/recent', auth, async (req, res) => {
  try {
    const { machineId } = req.params;
    
    // Use lean() for better performance and limit results
    const signals = await SignalData.find({ machineId })
      .populate('sensorId', 'name sensorType')
      .lean()
      .limit(10)
      .sort({ timestamp: -1 });

    res.json(signals);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Add/update signal data (optimized with upsert)
router.post('/', async (req, res) => {
  try {
    const { sensorId, machineId, value, timestamp } = req.body;
    
    await SignalData.findOneAndUpdate(
      { sensorId },
      { 
        machineId,
        value,
        timestamp: timestamp ? new Date(timestamp) : new Date()
      },
      { upsert: true, new: true }
    );

    res.status(201).json({ message: 'Signal data updated successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Batch update ongoing stoppages (optimized)
async function updateOngoingStoppagesOptimized() {
  try {
    const currentTime = new Date();
    const bulkOps = [];

    for (const [machineId, stoppageInfo] of unclassifiedStoppages) {
      const { id, startTime, hour, date } = stoppageInfo;
      const duration = Math.floor((currentTime - startTime) / 60000);
      
      bulkOps.push({
        updateOne: {
          filter: {
            machineId,
            startTime: { 
              $gte: new Date(date + 'T00:00:00.000Z'), 
              $lt: new Date(date + 'T23:59:59.999Z') 
            },
            'hourlyData.hour': hour,
            'hourlyData.stoppages._id': new mongoose.Types.ObjectId(id)
          },
          update: {
            $set: {
              'hourlyData.$[hour].stoppages.$[stoppage].duration': Math.min(60, duration),
              'hourlyData.$[hour].stoppageMinutes': duration
            }
          },
          arrayFilters: [
            { 'hour.hour': hour },
            { 'stoppage._id': new mongoose.Types.ObjectId(id) }
          ]
        }
      });
    }

    if (bulkOps.length > 0) {
      await ProductionRecord.bulkWrite(bulkOps);
    }
  } catch (error) {
    console.error('Error updating ongoing stoppages:', error);
  }
}

// Set up periodic batch updates for ongoing stoppages
setInterval(updateOngoingStoppagesOptimized, 60000); // Every minute

module.exports = router;