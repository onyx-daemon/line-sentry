const express = require('express');
const mongoose = require('mongoose');
const ProductionRecord = require('../models/ProductionRecord');
const Machine = require('../models/Machine');
const Config = require('../models/Config');
const { auth } = require('../middleware/auth');
const cacheManager = require('../utils/cache');
const AggregationHelper = require('../utils/aggregations');

const router = express.Router();

// Optimized machine stats calculation using aggregation
async function calculateMachineStatsOptimized(machineId, period) {
  // Check cache first
  const cached = cacheManager.getMachineStats(machineId, period);
  if (cached) {
    return cached;
  }

  const endDate = new Date();
  const startDate = new Date(endDate);
  
  if (period === '24h') {
    startDate.setHours(startDate.getHours() - 24);
  } else if (period === '7d') {
    startDate.setDate(startDate.getDate() - 7);
  } else if (period === '30d') {
    startDate.setDate(startDate.getDate() - 30);
  }

  try {
    const aggregation = AggregationHelper.getMachineStatsAggregation(machineId, startDate, endDate);
    const result = await ProductionRecord.aggregate(aggregation);
    
    const stats = result[0] || {
      totalUnitsProduced: 0,
      totalDefectiveUnits: 0,
      oee: 0,
      mtbf: 0,
      mttr: 0,
      availability: 0,
      quality: 0,
      performance: 0,
      totalRunningMinutes: 0,
      totalStoppageMinutes: 0,
      breakdownStoppages: 0,
      totalBreakdownMinutes: 0
    };

    // Cache the result
    cacheManager.setMachineStats(machineId, period, stats);
    return stats;
  } catch (error) {
    console.error('Error in optimized machine stats calculation:', error);
    // Fallback to basic stats
    return {
      totalUnitsProduced: 0,
      totalDefectiveUnits: 0,
      oee: 0,
      mtbf: 0,
      mttr: 0,
      availability: 0,
      quality: 0,
      performance: 0,
      totalRunningMinutes: 0,
      totalStoppageMinutes: 0,
      breakdownStoppages: 0,
      totalBreakdownMinutes: 0
    };
  }
}

// Optimized custom date range stats
async function calculateMachineStatsCustomOptimized(machineId, startDate, endDate) {
  try {
    const aggregation = AggregationHelper.getMachineStatsAggregation(machineId, startDate, endDate);
    const result = await ProductionRecord.aggregate(aggregation);
    
    return result[0] || {
      totalUnitsProduced: 0,
      totalDefectiveUnits: 0,
      oee: 0,
      mtbf: 0,
      mttr: 0,
      availability: 0,
      quality: 0,
      performance: 0,
      totalRunningMinutes: 0,
      totalStoppageMinutes: 0,
      breakdownStoppages: 0,
      totalBreakdownMinutes: 0
    };
  } catch (error) {
    console.error('Error in optimized custom stats calculation:', error);
    return {
      totalUnitsProduced: 0,
      totalDefectiveUnits: 0,
      oee: 0,
      mtbf: 0,
      mttr: 0,
      availability: 0,
      quality: 0,
      performance: 0,
      totalRunningMinutes: 0,
      totalStoppageMinutes: 0,
      breakdownStoppages: 0,
      totalBreakdownMinutes: 0
    };
  }
}

// Optimized timeline generation
async function generateTimelineOptimized(machineId, startDate, endDate) {
  try {
    // Single query to get all production records with populated data
    const productionRecords = await ProductionRecord.find({
      machineId,
      startTime: { $gte: startDate, $lte: endDate }
    })
    .populate('operatorId', 'username _id')
    .populate('moldId', 'name _id')
    .populate('hourlyData.operatorId', 'username _id')
    .populate('hourlyData.moldId', 'name _id')
    .lean(); // Use lean() for better performance

    // Generate timeline data efficiently
    const timeline = [];
    const currentDate = new Date(startDate);
    const finalDate = new Date(endDate);

    // Create a map for faster lookups
    const recordsMap = new Map();
    productionRecords.forEach(record => {
      const dateKey = new Date(record.startTime).toDateString();
      recordsMap.set(dateKey, record);
    });

    while (currentDate <= finalDate) {
      const dayStart = new Date(currentDate);
      dayStart.setUTCHours(0, 0, 0, 0);
      
      const dayData = {
        date: dayStart.toISOString().split('T')[0],
        hours: []
      };

      // Find production record for this day using map
      const dayRecord = recordsMap.get(dayStart.toDateString());

      for (let hour = 0; hour < 24; hour++) {
        const hourData = dayRecord?.hourlyData?.find(h => h.hour === hour);
        
        const runningMinutes = hourData?.runningMinutes || 0;
        const stoppageMinutes = hourData?.stoppages?.reduce((sum, s) => sum + (s.duration || 0), 0) || 0;

        let status = 'inactive';
        if (runningMinutes > 0) {
          status = stoppageMinutes > runningMinutes ? 'stoppage' : 'running';
        } else if (stoppageMinutes > 0) {
          status = 'stoppage';
        }

        dayData.hours.push({
          hour,
          unitsProduced: hourData?.unitsProduced || 0,
          defectiveUnits: hourData?.defectiveUnits || 0,
          status: hourData?.status || status,
          operator: hourData?.operatorId || dayRecord?.operatorId,
          mold: hourData?.moldId || dayRecord?.moldId,
          stoppages: hourData?.stoppages || [],
          runningMinutes,
          stoppageMinutes
        });
      }

      timeline.push(dayData);
      currentDate.setDate(currentDate.getDate() + 1);
    }

    return timeline;
  } catch (error) {
    console.error('Error generating optimized timeline:', error);
    return [];
  }
}

// Get production timeline for a machine (optimized)
router.get('/production-timeline/:machineId', auth, async (req, res) => {
  try {
    const { machineId } = req.params;
    const endDate = new Date();
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - 7);

    // Check access permissions with lean query
    const machine = await Machine.findById(machineId)
      .populate('departmentId', '_id')
      .lean();
    
    if (!machine) {
      return res.status(404).json({ message: 'Machine not found' });
    }

    if (req.user.role === 'operator' && req.user.departmentId?._id.toString() !== machine.departmentId._id.toString()) {
      return res.status(403).json({ message: 'Access denied to this machine' });
    }

    const timeline = await generateTimelineOptimized(machineId, startDate, endDate);
    res.json(timeline);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get machine statistics for custom date range (optimized)
router.get('/machine-stats/:machineId/custom', auth, async (req, res) => {
  try {
    const { machineId } = req.params;
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({ message: 'Start date and end date are required' });
    }

    // Check access permissions with lean query
    const machine = await Machine.findById(machineId)
      .populate('departmentId', '_id')
      .lean();
    
    if (!machine) {
      return res.status(404).json({ message: 'Machine not found' });
    }

    if (req.user.role === 'operator' && req.user.departmentId?._id.toString() !== machine.departmentId._id.toString()) {
      return res.status(403).json({ message: 'Access denied to this machine' });
    }

    const stats = await calculateMachineStatsCustomOptimized(machineId, new Date(startDate), new Date(endDate));
    res.json({
      ...stats,
      currentStatus: machine.status
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get production timeline for custom date range (optimized)
router.get('/production-timeline/:machineId/custom', auth, async (req, res) => {
  try {
    const { machineId } = req.params;
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({ message: 'Start date and end date are required' });
    }

    // Check access permissions with lean query
    const machine = await Machine.findById(machineId)
      .populate('departmentId', '_id')
      .lean();
    
    if (!machine) {
      return res.status(404).json({ message: 'Machine not found' });
    }

    if (req.user.role === 'operator' && req.user.departmentId?._id.toString() !== machine.departmentId._id.toString()) {
      return res.status(403).json({ message: 'Access denied to this machine' });
    }

    const timeline = await generateTimelineOptimized(machineId, new Date(startDate), new Date(endDate));
    res.json(timeline);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Add stoppage record (optimized)
router.post('/stoppage', auth, async (req, res) => {
  try {
    const { machineId, hour, date, reason, description, duration, pendingStoppageId, sapNotificationNumber } = req.body;
    const io = req.app.get('io');
    
    // Validate SAP notification number for breakdown
    if (reason === 'breakdown' && (!sapNotificationNumber || sapNotificationNumber.trim() === '')) {
      return res.status(400).json({ message: 'SAP notification number is required for breakdown stoppages' });
    }
    
    if (reason === 'breakdown' && sapNotificationNumber && !/^\d+$/.test(sapNotificationNumber.trim())) {
      return res.status(400).json({ message: 'SAP notification number must contain only numbers' });
    }
    
    // Use upsert for better performance
    const filter = {
      machineId,
      startTime: {
        $gte: new Date(date + 'T00:00:00.000Z'),
        $lt: new Date(date + 'T23:59:59.999Z')
      }
    };

    const update = {
      $setOnInsert: {
        machineId,
        startTime: new Date(date + 'T00:00:00.000Z'),
        unitsProduced: 0,
        defectiveUnits: 0
      }
    };

    let productionRecord = await ProductionRecord.findOneAndUpdate(
      filter,
      update,
      { upsert: true, new: true }
    );

    // Find or create hourly data
    let hourData = productionRecord.hourlyData.find(h => h.hour === hour);
    if (!hourData) {
      hourData = {
        hour,
        unitsProduced: 0,
        defectiveUnits: 0,
        status: 'stoppage',
        runningMinutes: 0,
        stoppageMinutes: 0,
        stoppages: []
      };
      productionRecord.hourlyData.push(hourData);
    }

    // Handle pending stoppage update or new stoppage
    if (pendingStoppageId) {
      const stoppageIndex = hourData.stoppages.findIndex(s => 
        (s._id && s._id.toString() === pendingStoppageId) || s.reason === 'unclassified'
      );
      
      if (stoppageIndex >= 0) {
        const pendingStoppage = hourData.stoppages[stoppageIndex];
        const actualDuration = Math.floor((new Date() - pendingStoppage.startTime) / (1000 * 60));
        
        hourData.stoppages[stoppageIndex].reason = reason;
        hourData.stoppages[stoppageIndex].description = description;
        hourData.stoppages[stoppageIndex].endTime = new Date();
        hourData.stoppages[stoppageIndex].duration = actualDuration;
        
        if (reason === 'breakdown') {
          hourData.stoppages[stoppageIndex].sapNotificationNumber = sapNotificationNumber;
        }
        
        hourData.stoppages[stoppageIndex].isPending = false;
        hourData.stoppages[stoppageIndex].isClassified = true;
      }
    } else {
      // Add new stoppage
      const stoppageStart = new Date(`${date}T${hour.toString().padStart(2, '0')}:00:00`);
      const stoppageEnd = new Date(stoppageStart.getTime() + (duration * 60 * 1000));
      
      const newStoppage = {
        reason,
        description,
        startTime: stoppageStart,
        endTime: stoppageEnd,
        duration,
        isPending: false,
        isClassified: true
      };
      
      if (reason === 'breakdown') {
        newStoppage.sapNotificationNumber = sapNotificationNumber;
      }
      
      hourData.stoppages.push(newStoppage);
    }

    hourData.status = 'stoppage';
    hourData.stoppageMinutes = hourData.stoppages.reduce((sum, s) => sum + (s.duration || 0), 0);

    await productionRecord.save();

    // Invalidate cache for this machine
    cacheManager.invalidateMachineStats(machineId);

    // Emit socket event
    io.emit('stoppage-added', {
      machineId,
      hour,
      date,
      stoppage: { reason, description, duration, sapNotificationNumber },
      timestamp: new Date()
    });

    res.status(201).json({ message: 'Stoppage recorded successfully' });
  } catch (error) {
    console.error('Error saving stoppage:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Update production assignment (optimized)
router.post('/production-assignment', auth, async (req, res) => {
  try {
    const { machineId, hour, date, operatorId, moldId, defectiveUnits, applyToShift } = req.body;
    const io = req.app.get('io');
    
    // Validate and convert IDs
    let validOperatorId = undefined;
    if (operatorId && operatorId.trim() !== '') {
      if (mongoose.Types.ObjectId.isValid(operatorId)) {
        validOperatorId = new mongoose.Types.ObjectId(operatorId);
      } else {
        const User = require('../models/User');
        const user = await User.findOne({ username: operatorId }).lean();
        if (user) {
          validOperatorId = user._id;
        } else {
          return res.status(400).json({ message: 'Invalid operator specified' });
        }
      }
    }

    let validMoldId = undefined;
    if (moldId && moldId.trim() !== '') {
      if (mongoose.Types.ObjectId.isValid(moldId)) {
        validMoldId = new mongoose.Types.ObjectId(moldId);
      } else {
        return res.status(400).json({ message: 'Invalid mold ID specified' });
      }
    }
    
    // Use upsert for production record
    const filter = {
      machineId,
      startTime: {
        $gte: new Date(date + 'T00:00:00.000Z'),
        $lt: new Date(date + 'T23:59:59.999Z')
      }
    };

    let productionRecord = await ProductionRecord.findOneAndUpdate(
      filter,
      {
        $setOnInsert: {
          machineId,
          startTime: new Date(date + 'T00:00:00.000Z'),
          unitsProduced: 0,
          defectiveUnits: 0,
          hourlyData: []
        }
      },
      { upsert: true, new: true }
    );

    // Get shift configuration from cache
    let config = cacheManager.getConfig();
    if (!config) {
      config = await Config.findOne().lean();
      if (config) {
        cacheManager.setConfig(config);
      }
    }
    
    const shifts = config?.shifts || [];
    
    // Determine hours to update
    let hoursToUpdate = [hour];
    if (applyToShift) {
      const shift = shifts.find(s => {
        const startHour = parseInt(s.startTime.split(':')[0]);
        const endHour = parseInt(s.endTime.split(':')[0]);
        
        if (startHour <= endHour) {
          return hour >= startHour && hour < endHour;
        } else {
          return hour >= startHour || hour < endHour;
        }
      });

      if (shift) {
        const startHour = parseInt(shift.startTime.split(':')[0]);
        const endHour = parseInt(shift.endTime.split(':')[0]);
        
        hoursToUpdate = [];
        
        if (startHour <= endHour) {
          for (let h = startHour; h < endHour; h++) {
            hoursToUpdate.push(h);
          }
        } else {
          if (hour >= startHour) {
            for (let h = startHour; h < 24; h++) {
              hoursToUpdate.push(h);
            }
          } else if (hour < endHour) {
            for (let h = 0; h < endHour; h++) {
              hoursToUpdate.push(h);
            }
          }
        }
      }
    }

    // Permission check for operators
    if (req.user.role === 'operator') {
      const currentUserId = req.user._id.toString();
      if (validOperatorId && validOperatorId.toString() !== currentUserId) {
        return res.status(403).json({ message: 'Operators can only assign themselves' });
      }
    }

    // Batch update hourly data
    for (const targetHour of hoursToUpdate) {
      let hourData = productionRecord.hourlyData.find(h => h.hour === targetHour);
      
      if (!hourData) {
        hourData = {
          hour: targetHour,
          unitsProduced: 0,
          defectiveUnits: 0,
          status: 'inactive',
          runningMinutes: 0,
          stoppageMinutes: 0,
          stoppages: []
        };
        
        if (validOperatorId !== undefined) hourData.operatorId = validOperatorId;
        if (validMoldId !== undefined) hourData.moldId = validMoldId;
        if (targetHour === hour && defectiveUnits !== undefined) hourData.defectiveUnits = defectiveUnits;
        
        productionRecord.hourlyData.push(hourData);
      } else {
        if (validOperatorId !== undefined) {
          hourData.operatorId = validOperatorId;
        } else {
          hourData.operatorId = undefined;
        }
        
        if (validMoldId !== undefined) {
          hourData.moldId = validMoldId;
        } else {
          hourData.moldId = undefined;
        }
        
        if (targetHour === hour && defectiveUnits !== undefined) {
          hourData.defectiveUnits = defectiveUnits;
        }
      }
    }

    // Update totals efficiently
    productionRecord.unitsProduced = productionRecord.hourlyData.reduce((sum, h) => sum + (h.unitsProduced || 0), 0);
    productionRecord.defectiveUnits = productionRecord.hourlyData.reduce((sum, h) => sum + (h.defectiveUnits || 0), 0);

    await productionRecord.save();

    // Invalidate cache for this machine
    cacheManager.invalidateMachineStats(machineId);

    // Emit socket event
    io.emit('production-assignment-updated', {
      machineId,
      hours: hoursToUpdate,
      date,
      operatorId: validOperatorId || null,
      moldId: validMoldId || null,
      originalHour: hour,
      defectiveUnits: hour === hour ? defectiveUnits : undefined,
      timestamp: new Date()
    });

    res.json({ message: 'Production assignment updated successfully' });
  } catch (error) {
    console.error('Error saving assignment:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get machine statistics (optimized with caching)
router.get('/machine-stats/:machineId', auth, async (req, res) => {
  try {
    const { machineId } = req.params;
    const { period = '24h' } = req.query;

    // Check access permissions with lean query
    const machine = await Machine.findById(machineId)
      .populate('departmentId', '_id')
      .lean();
    
    if (!machine) {
      return res.status(404).json({ message: 'Machine not found' });
    }

    if (req.user.role === 'operator' && req.user.departmentId?._id.toString() !== machine.departmentId._id.toString()) {
      return res.status(403).json({ message: 'Access denied to this machine' });
    }

    const stats = await calculateMachineStatsOptimized(machineId, period || '24h');
    res.json({
      ...stats,
      currentStatus: machine.status
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get department statistics (optimized with aggregation)
router.get('/department-stats/:departmentId', auth, async (req, res) => {
  try {
    const { departmentId } = req.params;
    
    // Check access permissions
    if (req.user.role === 'operator' && req.user.departmentId?._id.toString() !== departmentId) {
      return res.status(403).json({ message: 'Access denied to this department' });
    }

    const endDate = new Date();
    const startDate = new Date(endDate);
    startDate.setHours(startDate.getHours() - 24);

    try {
      const aggregation = AggregationHelper.getDepartmentStatsAggregation(departmentId, startDate, endDate);
      const result = await ProductionRecord.aggregate(aggregation);
      
      const stats = result[0] || { avgOEE: 0 };
      res.json(stats);
    } catch (error) {
      console.error('Error in department stats aggregation:', error);
      res.json({ avgOEE: 0 });
    }
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Batch endpoint for dashboard stats (new optimized endpoint)
router.get('/dashboard-stats', auth, async (req, res) => {
  try {
    const endDate = new Date();
    const startDate = new Date(endDate);
    startDate.setHours(startDate.getHours() - 24);

    // Use aggregation for factory stats
    const factoryStatsAggregation = AggregationHelper.getFactoryStatsAggregation(startDate, endDate);
    const unclassifiedAggregation = AggregationHelper.getUnclassifiedStoppagesCountAggregation();

    const [factoryStatsResult, unclassifiedResult] = await Promise.all([
      ProductionRecord.aggregate(factoryStatsAggregation),
      ProductionRecord.aggregate(unclassifiedAggregation)
    ]);

    const factoryStats = factoryStatsResult[0] || {
      totalUnits: 0,
      avgOEE: 0,
      activeMachines: 0,
      totalMachines: 0
    };

    const unclassifiedCount = unclassifiedResult[0]?.total || 0;

    res.json({
      ...factoryStats,
      unclassifiedStoppages: unclassifiedCount
    });
  } catch (error) {
    console.error('Error fetching dashboard stats:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;