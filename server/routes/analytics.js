const express = require('express');
const mongoose = require('mongoose');
const ProductionRecord = require('../models/ProductionRecord');
const Machine = require('../models/Machine');
const Config = require('../models/Config');
const User = require('../models/User');
const Mold = require('../models/Mold');
const { auth } = require('../middleware/auth');

const router = express.Router();

const PERIODS = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000
};

// Machine stats calculation
async function calculateMachineStats(machineId, period) {
  const now = Date.now();
  const startDate = new Date(now - PERIODS[period]);
  const endDate = new Date(now);

  const aggregation = await ProductionRecord.aggregate([
    {
      $match: {
        machineId: new mongoose.Types.ObjectId(machineId),
        startTime: { $gte: startDate, $lte: endDate }
      }
    },
    {
      $unwind: "$hourlyData"
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
      $addFields: {
        moldData: { $arrayElemAt: ["$moldData", 0] }
      }
    },
    {
      $group: {
        _id: null,
        // Calculate from hourly data, not top-level
        totalUnitsProduced: { $sum: "$hourlyData.unitsProduced" },
        totalDefectiveUnits: { $sum: "$hourlyData.defectiveUnits" },
        totalRunningMinutes: { $sum: "$hourlyData.runningMinutes" },
        totalStoppageMinutes: { $sum: "$hourlyData.stoppageMinutes" },
        // Use $sum with $size for accurate count
        totalStoppages: { $sum: { $size: "$hourlyData.stoppages" } },
        //  breakdown calculation
        breakdownStoppages: {
          $sum: {
            $size: {
              $filter: {
                input: "$hourlyData.stoppages",
                as: "stoppage",
                cond: { $eq: ["$$stoppage.reason", "breakdown"] }
              }
            }
          }
        },
        totalBreakdownMinutes: {
          $sum: {
            $sum: {
              $map: {
                input: {
                  $filter: {
                    input: "$hourlyData.stoppages",
                    as: "stoppage",
                    cond: { $eq: ["$$stoppage.reason", "breakdown"] }
                  }
                },
                as: "bs",
                in: "$$bs.duration"
              }
            }
          }
        },
        // Calculate expected units in aggregation
        totalExpectedUnits: {
          $sum: {
            $cond: [
              { $gt: ["$moldData.productionCapacityPerHour", 0] },
              {
                $multiply: [
                  { $divide: ["$moldData.productionCapacityPerHour", 60] },
                  "$hourlyData.runningMinutes"
                ]
              },
              0
            ]
          }
        }
      }
    }
  ]);

  if (aggregation.length === 0) {
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

  const stats = aggregation[0];
  
  // Calculate metrics
  const totalAvailableMinutes = stats.totalRunningMinutes + stats.totalStoppageMinutes;
  const availability = totalAvailableMinutes > 0 
    ? stats.totalRunningMinutes / totalAvailableMinutes
    : 0;
  
  const quality = stats.totalUnitsProduced > 0 
    ? (stats.totalUnitsProduced - stats.totalDefectiveUnits) / stats.totalUnitsProduced
    : 0;
  
  // CORRECTED: Use aggregated totalExpectedUnits
  const performance = stats.totalExpectedUnits > 0 
    ? stats.totalUnitsProduced / stats.totalExpectedUnits
    : 0;
  
  const oee = availability * quality * performance;

  // Calculate MTBF and MTTR
  const mtbf = stats.breakdownStoppages > 0 
    ? stats.totalRunningMinutes / stats.breakdownStoppages 
    : 0;
    
  const mttr = stats.breakdownStoppages > 0 
    ? stats.totalBreakdownMinutes / stats.breakdownStoppages 
    : 0;

  return {
    totalUnitsProduced: stats.totalUnitsProduced,
    totalDefectiveUnits: stats.totalDefectiveUnits,
    oee: Math.round(oee * 100),
    mtbf: Math.round(mtbf),
    mttr: Math.round(mttr),
    availability: Math.round(availability * 100),
    quality: Math.round(quality * 100),
    performance: Math.round(performance * 100),
    totalRunningMinutes: stats.totalRunningMinutes,
    totalStoppageMinutes: stats.totalStoppageMinutes,
    breakdownStoppages: stats.breakdownStoppages,
    totalBreakdownMinutes: stats.totalBreakdownMinutes
  };
}

// Get production timeline for a machine (7 days)
router.get('/production-timeline/:machineId', auth, async (req, res) => {
  try {
    const { machineId } = req.params;
    const endDate = new Date();
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - 7);

    // Check access permissions
    const machine = await Machine.findById(machineId).populate('departmentId').lean();
    if (!machine) {
      return res.status(404).json({ message: 'Machine not found' });
    }

    if (req.user.role === 'operator' && req.user.departmentId?._id.toString() !== machine.departmentId._id.toString()) {
      return res.status(403).json({ message: 'Access denied to this machine' });
    }

    // Use aggregation pipeline for better performance
    const productionRecords = await ProductionRecord.aggregate([
      {
        $match: {
          machineId: new mongoose.Types.ObjectId(machineId),
          startTime: { $gte: startDate, $lte: endDate }
        }
      },
      {
        $lookup: {
          from: 'users',
          localField: 'operatorId',
          foreignField: '_id',
          as: 'operatorId'
        }
      },
      {
        $lookup: {
          from: 'molds',
          localField: 'moldId',
          foreignField: '_id',
          as: 'moldId'
        }
      },
      {
        $lookup: {
          from: 'users',
          localField: 'hourlyData.operatorId',
          foreignField: '_id',
          as: 'hourlyOperators'
        }
      },
      {
        $lookup: {
          from: 'molds',
          localField: 'hourlyData.moldId',
          foreignField: '_id',
          as: 'hourlyMolds'
        }
      },
      {
        $addFields: {
          operatorId: { $arrayElemAt: ['$operatorId', 0] },
          moldId: { $arrayElemAt: ['$moldId', 0] },
          hourlyData: {
            $map: {
              input: '$hourlyData',
              as: 'hour',
              in: {
                $mergeObjects: [
                  '$$hour',
                  {
                    operatorId: {
                      $arrayElemAt: [
                        {
                          $filter: {
                            input: '$hourlyOperators',
                            cond: { $eq: ['$$this._id', '$$hour.operatorId'] }
                          }
                        },
                        0
                      ]
                    },
                    moldId: {
                      $arrayElemAt: [
                        {
                          $filter: {
                            input: '$hourlyMolds',
                            cond: { $eq: ['$$this._id', '$$hour.moldId'] }
                          }
                        },
                        0
                      ]
                    }
                  }
                ]
              }
            }
          }
        }
      }
    ]);

    // Generate timeline data for the last 7 days
    const timeline = [];
    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
      const dayStart = new Date(d);
      dayStart.setUTCHours(0, 0, 0, 0);
      const dayEnd = new Date(dayStart);
      dayEnd.setUTCDate(dayStart.getUTCDate() + 1);

      const dayData = {
        date: dayStart.toISOString().split('T')[0],
        hours: []
      };

      // Find production record for this day
      const dayRecord = productionRecords.find(record => {
        const recordDate = new Date(record.startTime);
        return recordDate.toDateString() === dayStart.toDateString();
      });

      for (let hour = 0; hour < 24; hour++) {
        const hourData = dayRecord?.hourlyData?.find(h => h.hour === hour);
        
        // Calculate running vs stoppage time
        const runningMinutes = hourData?.runningMinutes || 0;
        const stoppageMinutes = hourData?.stoppages?.reduce((sum, s) => sum + (s.duration || 0), 0) || 0;

        // Determine status based on activity
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
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Add stoppage record
router.post('/stoppage', auth, async (req, res) => {
  try {
    const { machineId, hour, date, reason, description, duration, pendingStoppageId, sapNotificationNumber } = req.body;
    const io = req.app.get('io');
    
    // Early validation
    if (reason === 'breakdown') {
      if (!sapNotificationNumber?.trim()) {
        return res.status(400).json({ message: 'SAP number required' });
      }
      if (!/^\d+$/.test(sapNotificationNumber.trim())) {
        return res.status(400).json({ message: 'Invalid SAP number format' });
      }
    }

    // Date range for query
    const dayStart = new Date(`${date}T00:00:00.000Z`);
    const dayEnd = new Date(`${date}T23:59:59.999Z`);
    
    // Find or create record efficiently
    let productionRecord = await ProductionRecord.findOneAndUpdate(
      { machineId, startTime: { $gte: dayStart, $lt: dayEnd } },
      {},
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    // Find or initialize hour data
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

    // Handle pending stoppages
    if (pendingStoppageId) {
      const index = hourData.stoppages.findIndex(s => 
        s._id?.toString() === pendingStoppageId || s.reason === 'unclassified'
      );
      
      if (index >= 0) {
        const now = new Date();
        const actualDuration = Math.floor((now - hourData.stoppages[index].startTime) / 60000);
        
        hourData.stoppages[index] = {
          ...hourData.stoppages[index],
          reason,
          description,
          endTime: now,
          duration: actualDuration,
          sapNotificationNumber: reason === 'breakdown' ? sapNotificationNumber : undefined,
          isPending: false,
          isClassified: true
        };
      } else {
        return res.status(404).json({ message: 'Pending stoppage not found' });
      }
    } 
    // Add new stoppage
    else {
      const stoppageStart = new Date(`${date}T${hour.toString().padStart(2, '0')}:00:00Z`);
      const stoppageEnd = new Date(stoppageStart.getTime() + duration * 60000);
      
      hourData.stoppages.push({
        reason,
        description,
        startTime: stoppageStart,
        endTime: stoppageEnd,
        duration,
        isPending: false,
        isClassified: true,
        ...(reason === 'breakdown' && { sapNotificationNumber })
      });
    }

    // Update stoppage minutes
    hourData.stoppageMinutes = hourData.stoppages.reduce((sum, s) => sum + (s.duration || 0), 0);
    hourData.status = 'stoppage';

    // Optimized save
    await productionRecord.save();

    // Socket emission
    io.emit('stoppage-added', {
      machineId,
      hour,
      date,
      stoppage: { reason, description, duration, sapNotificationNumber },
      timestamp: new Date()
    });

    res.status(201).json({ message: 'Stoppage recorded' });
  } catch (error) {
    console.error('Stoppage error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Update production assignment
router.post('/production-assignment', auth, async (req, res) => {
  try {
    const { machineId, hour, date, operatorId, moldId, defectiveUnits, applyToShift } = req.body;
    const io = req.app.get('io');
    
    // Validate IDs
    const User = require('../models/User');
    let validOperatorId;
    if (operatorId) {
      if (mongoose.Types.ObjectId.isValid(operatorId)) {
        validOperatorId = operatorId;
      } else {
        const user = await User.findOne({ username: operatorId }, '_id').lean();
        if (user) validOperatorId = user._id;
        else return res.status(400).json({ message: 'Invalid operator' });
      }
    }

    let validMoldId;
    if (moldId && !mongoose.Types.ObjectId.isValid(moldId)) {
      return res.status(400).json({ message: 'Invalid mold ID' });
    }
    validMoldId = moldId;

    // Permission check
    if (req.user.role === 'operator' && validOperatorId && validOperatorId !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Can only assign yourself' });
    }

    // Date range for query
    const dayStart = new Date(`${date}T00:00:00.000Z`);
    const dayEnd = new Date(`${date}T23:59:59.999Z`);
    
    // Find or create record
    let productionRecord = await ProductionRecord.findOneAndUpdate(
      { machineId, startTime: { $gte: dayStart, $lt: dayEnd } },
      {},
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    // Get shift hours if needed
    let hoursToUpdate = [hour];
    if (applyToShift) {
      const config = await Config.findOne().select('shifts').lean();
      const shift = config?.shifts?.find(s => {
        const [startH] = s.startTime.split(':').map(Number);
        const [endH] = s.endTime.split(':').map(Number);
        return (startH <= hour && hour < endH) || 
               (startH > endH && (hour >= startH || hour < endH));
      });
      
      if (shift) {
        const [startH] = shift.startTime.split(':').map(Number);
        const [endH] = shift.endTime.split(':').map(Number);
        
        hoursToUpdate = [];
        if (startH < endH) {
          for (let h = startH; h < endH; h++) hoursToUpdate.push(h);
        } else {
          for (let h = startH; h < 24; h++) hoursToUpdate.push(h);
          for (let h = 0; h < endH; h++) hoursToUpdate.push(h);
        }
      }
    }

    // Update hours in bulk
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

      // Update fields
      if (validOperatorId !== undefined) {
        hourData.operatorId = validOperatorId || undefined;
      }
      if (validMoldId !== undefined) {
        hourData.moldId = validMoldId || undefined;
      }
      if (targetHour === hour && defectiveUnits !== undefined) {
        hourData.defectiveUnits = defectiveUnits;
      }
    }

    // Optimized totals calculation
    productionRecord.unitsProduced = productionRecord.hourlyData.reduce((sum, h) => sum + (h.unitsProduced || 0), 0);
    productionRecord.defectiveUnits = productionRecord.hourlyData.reduce((sum, h) => sum + (h.defectiveUnits || 0), 0);

    await productionRecord.save();

    // Socket event
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

    res.json({ message: 'Assignment updated' });
  } catch (error) {
    console.error('Assignment error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get machine statistics
router.get('/machine-stats/:machineId', auth, async (req, res) => {
  try {
    const { machineId } = req.params;
    const { period = '24h' } = req.query;

    // Lean permission check
    const machine = await Machine.findById(machineId)
      .select('departmentId status')
      .populate('departmentId', '_id')
      .lean();
      
    if (!machine) return res.status(404).json({ message: 'Machine not found' });

    if (req.user.role === 'operator' && 
        req.user.departmentId?._id.toString() !== machine.departmentId._id.toString()) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const stats = await calculateMachineStats(machineId, period);
    res.json({ ...stats, currentStatus: machine.status });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get department statistics
router.get('/department-stats/:departmentId', auth, async (req, res) => {
  try {
    const { departmentId } = req.params;
    
    // Permission check
    if (req.user.role === 'operator' && req.user.departmentId?._id.toString() !== departmentId) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Get machine IDs
    const machines = await Machine.find(
      { departmentId, isActive: true }, 
      '_id'
    ).lean();

    // Parallel stats calculation
    const statsPromises = machines.map(machine => 
      calculateMachineStats(machine._id, '24h')
        .then(stats => stats.oee)
        .catch(() => 0)
    );

    const oeeValues = await Promise.all(statsPromises);
    const validOEEs = oeeValues.filter(oee => oee > 0);
    const avgOEE = validOEEs.length > 0 
      ? Math.round(validOEEs.reduce((sum, oee) => sum + oee, 0) / validOEEs.length) 
      : 0;

    res.json({ avgOEE });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Factory statistics
router.get('/factory-stats', auth, async (req, res) => {
  try {
    const machines = await Machine.find({ isActive: true }).lean();
    const machineIds = machines.map(m => m._id);

    // Get stats for all machines in parallel
    const statsPromises = machineIds.map(machineId => 
      calculateMachineStats(machineId, '24h').catch(() => null)
    );
    
    const allStats = await Promise.all(statsPromises);
    
    // Calculate totals
    let totalUnits = 0;
    let totalOEE = 0;
    let activeMachines = 0;
    let validOEEs = 0;
    
    allStats.forEach((stats, index) => {
      if (stats) {
        totalUnits += stats.totalUnitsProduced;
        if (stats.oee > 0) {
          totalOEE += stats.oee;
          validOEEs++;
        }
        if (machines[index].status === 'running') {
          activeMachines++;
        }
      }
    });

    // Get unclassified stoppages
    const unclassifiedData = await ProductionRecord.aggregate([
      {
        $match: {
          "hourlyData.stoppages": {
            $elemMatch: { reason: "unclassified" }
          }
        }
      },
      {
        $project: {
          count: {
            $size: {
              $filter: {
                input: "$hourlyData.stoppages",
                as: "s",
                cond: { $eq: ["$$s.reason", "unclassified"] }
              }
            }
          }
        }
      }
    ]);

    const unclassifiedStoppages = unclassifiedData.reduce((sum, doc) => sum + doc.count, 0);

    res.json({
      totalUnits,
      avgOEE: validOEEs > 0 ? Math.round(totalOEE / validOEEs) : 0,
      unclassifiedStoppages,
      activeMachines
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;