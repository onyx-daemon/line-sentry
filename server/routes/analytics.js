const express = require('express');
const mongoose = require('mongoose');
const ProductionRecord = require('../models/ProductionRecord');
const Machine = require('../models/Machine');
const Config = require('../models/Config');
const { auth } = require('../middleware/auth');

const router = express.Router();

// Helper function to calculate machine stats with optimized queries
async function calculateMachineStats(machineId, period) {
  const endDate = new Date();
  const startDate = new Date(endDate);
  
  if (period === '24h') {
    startDate.setHours(startDate.getHours() - 24);
  } else if (period === '7d') {
    startDate.setDate(startDate.getDate() - 7);
  } else if (period === '30d') {
    startDate.setDate(startDate.getDate() - 30);
  }

  // Optimized aggregation pipeline
  const pipeline = [
    {
      $match: {
        machineId: new mongoose.Types.ObjectId(machineId),
        startTime: { $gte: startDate, $lte: endDate }
      }
    },
    {
      $lookup: {
        from: 'molds',
        localField: 'hourlyData.moldId',
        foreignField: '_id',
        as: 'moldData'
      }
    },
    {
      $unwind: { path: '$hourlyData', preserveNullAndEmptyArrays: true }
    },
    {
      $group: {
        _id: null,
        totalUnitsProduced: { $sum: '$unitsProduced' },
        totalDefectiveUnits: { $sum: '$defectiveUnits' },
        totalRunningMinutes: { $sum: '$hourlyData.runningMinutes' },
        totalStoppageMinutes: { $sum: '$hourlyData.stoppageMinutes' },
        hourlyData: { $push: '$hourlyData' },
        moldData: { $first: '$moldData' }
      }
    }
  ];

  const [result] = await ProductionRecord.aggregate(pipeline);
  
  if (!result) {
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

  // Calculate metrics from aggregated data
  let totalExpectedUnits = 0;
  let breakdownStoppages = 0;
  let totalBreakdownMinutes = 0;

  result.hourlyData.forEach(hourData => {
    // Calculate expected units
    const moldCapacity = result.moldData.find(m => 
      m._id.toString() === hourData.moldId?.toString()
    )?.productionCapacityPerHour;
    
    if (moldCapacity) {
      const capacityPerMinute = moldCapacity / 60;
      totalExpectedUnits += capacityPerMinute * (hourData.runningMinutes || 0);
    }

    // Count breakdown stoppages
    hourData.stoppages?.forEach(stoppage => {
      if (stoppage.reason === 'breakdown') {
        breakdownStoppages++;
        totalBreakdownMinutes += stoppage.duration || 0;
      }
    });
  });

  // Calculate metrics
  const totalAvailableMinutes = result.totalRunningMinutes + result.totalStoppageMinutes;
  const availability = totalAvailableMinutes > 0 
    ? (result.totalRunningMinutes / totalAvailableMinutes)
    : 0;
  
  const quality = result.totalUnitsProduced > 0 
    ? (result.totalUnitsProduced - result.totalDefectiveUnits) / result.totalUnitsProduced 
    : 0;

  const performance = totalExpectedUnits > 0 
    ? (result.totalUnitsProduced / totalExpectedUnits)
    : 0;
  
  const oee = availability * quality * performance;
  const mtbf = breakdownStoppages > 0 ? result.totalRunningMinutes / breakdownStoppages : 0;
  const mttr = breakdownStoppages > 0 ? totalBreakdownMinutes / breakdownStoppages : 0;

  return {
    totalUnitsProduced: result.totalUnitsProduced,
    totalDefectiveUnits: result.totalDefectiveUnits,
    oee: Math.round(oee * 100),
    mtbf: Math.round(mtbf),
    mttr: Math.round(mttr),
    availability: Math.round(availability * 100),
    quality: Math.round(quality * 100),
    performance: Math.round(performance * 100),
    totalRunningMinutes: result.totalRunningMinutes,
    totalStoppageMinutes: result.totalStoppageMinutes,
    breakdownStoppages,
    totalBreakdownMinutes
  };
}

// Get production timeline for a machine (7 days) - Optimized
router.get('/production-timeline/:machineId', auth, async (req, res) => {
  try {
    const { machineId } = req.params;
    
    // Validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(machineId)) {
      return res.status(400).json({ message: 'Invalid machine ID' });
    }

    const endDate = new Date();
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - 7);

    // Check access permissions with single query
    const machine = await Machine.findById(machineId)
      .populate('departmentId')
      .select('departmentId')
      .lean();
      
    if (!machine) {
      return res.status(404).json({ message: 'Machine not found' });
    }

    if (req.user.role === 'operator' && 
        req.user.departmentId?._id.toString() !== machine.departmentId._id.toString()) {
      return res.status(403).json({ message: 'Access denied to this machine' });
    }

    // Optimized aggregation for production records
    const productionRecords = await ProductionRecord.find({
      machineId: new mongoose.Types.ObjectId(machineId),
      startTime: { $gte: startDate, $lte: endDate }
    })
    .populate('operatorId', 'username')
    .populate('moldId', 'name')
    .populate('hourlyData.operatorId', 'username')
    .populate('hourlyData.moldId', 'name')
    .lean();

    // Generate timeline data efficiently
    const timeline = [];
    const recordsMap = new Map();
    
    // Index records by date for O(1) lookup
    productionRecords.forEach(record => {
      const recordDate = new Date(record.startTime).toISOString().split('T')[0];
      recordsMap.set(recordDate, record);
    });

    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
      const dayStart = new Date(d);
      dayStart.setUTCHours(0, 0, 0, 0);
      const dateKey = dayStart.toISOString().split('T')[0];

      const dayData = {
        date: dateKey,
        hours: []
      };

      const dayRecord = recordsMap.get(dateKey);

      // Pre-build hourly data map for O(1) lookup
      const hourlyDataMap = new Map();
      if (dayRecord?.hourlyData) {
        dayRecord.hourlyData.forEach(h => hourlyDataMap.set(h.hour, h));
      }

      for (let hour = 0; hour < 24; hour++) {
        const hourData = hourlyDataMap.get(hour);
        
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
    }

    res.json(timeline);
  } catch (error) {
    console.error('Timeline error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Add stoppage record - Optimized
router.post('/stoppage', auth, async (req, res) => {
  try {
    const { machineId, hour, date, reason, description, duration, pendingStoppageId, sapNotificationNumber } = req.body;
    const io = req.app.get('io');
    
    // Validate inputs
    if (!machineId || hour === undefined || !date || !reason) {
      return res.status(400).json({ message: 'Missing required fields' });
    }

    if (!mongoose.Types.ObjectId.isValid(machineId)) {
      return res.status(400).json({ message: 'Invalid machine ID' });
    }
    
    // Validate SAP notification number for breakdown
    if (reason === 'breakdown') {
      if (!sapNotificationNumber || sapNotificationNumber.trim() === '') {
        return res.status(400).json({ message: 'SAP notification number is required for breakdown stoppages' });
      }
      if (!/^\d+$/.test(sapNotificationNumber.trim())) {
        return res.status(400).json({ message: 'SAP notification number must contain only numbers' });
      }
    }
    
    // Use upsert for better performance
    const dateStart = new Date(date + 'T00:00:00.000Z');
    const dateEnd = new Date(date + 'T23:59:59.999Z');

    let productionRecord = await ProductionRecord.findOneAndUpdate(
      {
        machineId: new mongoose.Types.ObjectId(machineId),
        startTime: { $gte: dateStart, $lt: dateEnd }
      },
      {
        $setOnInsert: {
          machineId: new mongoose.Types.ObjectId(machineId),
          startTime: dateStart,
          hourlyData: []
        }
      },
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
        
        // Update existing pending stoppage
        Object.assign(hourData.stoppages[stoppageIndex], {
          reason,
          description,
          endTime: new Date(),
          duration: actualDuration,
          ...(reason === 'breakdown' && { sapNotificationNumber }),
          isPending: false,
          isClassified: true
        });
      } else {
        // Create new stoppage if pending not found
        const stoppageStart = new Date(`${date}T${hour.toString().padStart(2, '0')}:00:00`);
        const newStoppage = {
          reason,
          description,
          startTime: stoppageStart,
          endTime: new Date(stoppageStart.getTime() + (duration * 60 * 1000)),
          duration,
          isPending: false,
          isClassified: true,
          ...(reason === 'breakdown' && { sapNotificationNumber })
        };
        
        hourData.stoppages.push(newStoppage);
      }
    } else {
      // Add new stoppage
      const stoppageStart = new Date(`${date}T${hour.toString().padStart(2, '0')}:00:00`);
      const newStoppage = {
        reason,
        description,
        startTime: stoppageStart,
        endTime: new Date(stoppageStart.getTime() + (duration * 60 * 1000)),
        duration,
        isPending: false,
        isClassified: true,
        ...(reason === 'breakdown' && { sapNotificationNumber })
      };
      
      hourData.stoppages.push(newStoppage);
    }

    // Update stoppage minutes and status
    hourData.stoppageMinutes = hourData.stoppages.reduce((sum, s) => sum + (s.duration || 0), 0);
    hourData.status = 'stoppage';

    // Mark as modified and save
    productionRecord.markModified('hourlyData');
    await productionRecord.save();

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

// Update production assignment - Optimized
router.post('/production-assignment', auth, async (req, res) => {
  try {
    const { machineId, hour, date, operatorId, moldId, defectiveUnits, applyToShift } = req.body;
    const io = req.app.get('io');
    
    // Validate inputs
    if (!machineId || hour === undefined || !date) {
      return res.status(400).json({ message: 'Missing required fields' });
    }

    if (!mongoose.Types.ObjectId.isValid(machineId)) {
      return res.status(400).json({ message: 'Invalid machine ID' });
    }
    
    // Validate and convert IDs
    let validOperatorId, validMoldId;
    
    if (operatorId && operatorId.trim() !== '') {
      if (mongoose.Types.ObjectId.isValid(operatorId)) {
        validOperatorId = new mongoose.Types.ObjectId(operatorId);
      } else {
        const User = require('../models/User');
        const user = await User.findOne({ username: operatorId }).select('_id').lean();
        if (user) {
          validOperatorId = user._id;
        } else {
          return res.status(400).json({ message: 'Invalid operator specified' });
        }
      }
    }

    if (moldId && moldId.trim() !== '') {
      if (mongoose.Types.ObjectId.isValid(moldId)) {
        validMoldId = new mongoose.Types.ObjectId(moldId);
      } else {
        return res.status(400).json({ message: 'Invalid mold ID specified' });
      }
    }
    
    // Permission check for operators
    if (req.user.role === 'operator') {
      const currentUserId = req.user._id.toString();
      if (validOperatorId && validOperatorId.toString() !== currentUserId) {
        return res.status(403).json({ message: 'Operators can only assign themselves' });
      }
    }

    // Get shifts configuration once
    const config = await Config.findOne().select('shifts').lean();
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

    // Use upsert for production record
    const dateStart = new Date(date + 'T00:00:00.000Z');
    const dateEnd = new Date(date + 'T23:59:59.999Z');

    let productionRecord = await ProductionRecord.findOneAndUpdate(
      {
        machineId: new mongoose.Types.ObjectId(machineId),
        startTime: { $gte: dateStart, $lt: dateEnd }
      },
      {
        $setOnInsert: {
          machineId: new mongoose.Types.ObjectId(machineId),
          startTime: dateStart,
          hourlyData: []
        }
      },
      { upsert: true, new: true }
    );

    // Bulk update hourly data
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
        productionRecord.hourlyData.push(hourData);
      }

      // Update assignments
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

    // Update totals efficiently
    productionRecord.unitsProduced = productionRecord.hourlyData.reduce(
      (sum, h) => sum + (h.unitsProduced || 0), 0
    );
    productionRecord.defectiveUnits = productionRecord.hourlyData.reduce(
      (sum, h) => sum + (h.defectiveUnits || 0), 0
    );

    productionRecord.markModified('hourlyData');
    await productionRecord.save();

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

// Get machine statistics - Optimized
router.get('/machine-stats/:machineId', auth, async (req, res) => {
  try {
    const { machineId } = req.params;
    const { period = '24h' } = req.query;

    if (!mongoose.Types.ObjectId.isValid(machineId)) {
      return res.status(400).json({ message: 'Invalid machine ID' });
    }

    // Check access permissions with lean query
    const machine = await Machine.findById(machineId)
      .populate('departmentId', '_id')
      .select('status departmentId')
      .lean();
      
    if (!machine) {
      return res.status(404).json({ message: 'Machine not found' });
    }

    if (req.user.role === 'operator' && 
        req.user.departmentId?._id.toString() !== machine.departmentId._id.toString()) {
      return res.status(403).json({ message: 'Access denied to this machine' });
    }

    const stats = await calculateMachineStats(machineId, period || '24h');
    res.json({
      ...stats,
      currentStatus: machine.status
    });
  } catch (error) {
    console.error('Machine stats error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get department statistics - Optimized
router.get('/department-stats/:departmentId', auth, async (req, res) => {
  try {
    const { departmentId } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(departmentId)) {
      return res.status(400).json({ message: 'Invalid department ID' });
    }
    
    // Check access permissions
    if (req.user.role === 'operator' && 
        req.user.departmentId?._id.toString() !== departmentId) {
      return res.status(403).json({ message: 'Access denied to this department' });
    }

    // Get machines with single query
    const machines = await Machine.find({ 
      departmentId: new mongoose.Types.ObjectId(departmentId), 
      isActive: true 
    }).select('_id').lean();
    
    if (machines.length === 0) {
      return res.json({ avgOEE: 0 });
    }

    // Calculate stats for all machines in parallel
    const statsPromises = machines.map(machine => 
      calculateMachineStats(machine._id, '24h').catch(() => ({ oee: 0 }))
    );
    
    const allStats = await Promise.all(statsPromises);
    
    const totalOEE = allStats.reduce((sum, stats) => sum + (stats.oee || 0), 0);
    const avgOEE = machines.length > 0 ? Math.round(totalOEE / machines.length) : 0;
    
    res.json({ avgOEE });
  } catch (error) {
    console.error('Department stats error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;