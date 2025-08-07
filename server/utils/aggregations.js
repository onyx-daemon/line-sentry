const mongoose = require('mongoose');

class AggregationHelper {
  // Optimized machine stats calculation with single aggregation
  static getMachineStatsAggregation(machineId, startDate, endDate) {
    return [
      {
        $match: {
          machineId: new mongoose.Types.ObjectId(machineId),
          startTime: { $gte: startDate, $lte: endDate }
        }
      },
      {
        $unwind: {
          path: '$hourlyData',
          preserveNullAndEmptyArrays: true
        }
      },
      {
        $lookup: {
          from: 'molds',
          localField: 'hourlyData.moldId',
          foreignField: '_id',
          as: 'moldInfo'
        }
      },
      {
        $group: {
          _id: null,
          totalUnitsProduced: { $sum: '$unitsProduced' },
          totalDefectiveUnits: { $sum: '$defectiveUnits' },
          totalRunningMinutes: { $sum: '$hourlyData.runningMinutes' },
          totalStoppageMinutes: { $sum: '$hourlyData.stoppageMinutes' },
          totalStoppages: { $sum: { $size: { $ifNull: ['$hourlyData.stoppages', []] } } },
          breakdownStoppages: {
            $sum: {
              $size: {
                $filter: {
                  input: { $ifNull: ['$hourlyData.stoppages', []] },
                  cond: { $eq: ['$$this.reason', 'breakdown'] }
                }
              }
            }
          },
          totalBreakdownMinutes: {
            $sum: {
              $reduce: {
                input: { $ifNull: ['$hourlyData.stoppages', []] },
                initialValue: 0,
                in: {
                  $cond: [
                    { $eq: ['$$this.reason', 'breakdown'] },
                    { $add: ['$$value', { $ifNull: ['$$this.duration', 0] }] },
                    '$$value'
                  ]
                }
              }
            }
          },
          totalExpectedUnits: {
            $sum: {
              $multiply: [
                { $divide: [{ $arrayElemAt: ['$moldInfo.productionCapacityPerHour', 0] }, 60] },
                '$hourlyData.runningMinutes'
              ]
            }
          }
        }
      },
      {
        $project: {
          totalUnitsProduced: 1,
          totalDefectiveUnits: 1,
          totalRunningMinutes: 1,
          totalStoppageMinutes: 1,
          totalStoppages: 1,
          breakdownStoppages: 1,
          totalBreakdownMinutes: 1,
          totalExpectedUnits: 1,
          availability: {
            $cond: [
              { $gt: [{ $add: ['$totalRunningMinutes', '$totalStoppageMinutes'] }, 0] },
              {
                $divide: [
                  '$totalRunningMinutes',
                  { $add: ['$totalRunningMinutes', '$totalStoppageMinutes'] }
                ]
              },
              0
            ]
          },
          quality: {
            $cond: [
              { $gt: ['$totalUnitsProduced', 0] },
              {
                $divide: [
                  { $subtract: ['$totalUnitsProduced', '$totalDefectiveUnits'] },
                  '$totalUnitsProduced'
                ]
              },
              0
            ]
          },
          performance: {
            $cond: [
              { $gt: ['$totalExpectedUnits', 0] },
              { $divide: ['$totalUnitsProduced', '$totalExpectedUnits'] },
              0
            ]
          },
          mtbf: {
            $cond: [
              { $gt: ['$breakdownStoppages', 0] },
              { $divide: ['$totalRunningMinutes', '$breakdownStoppages'] },
              0
            ]
          },
          mttr: {
            $cond: [
              { $gt: ['$breakdownStoppages', 0] },
              { $divide: ['$totalBreakdownMinutes', '$breakdownStoppages'] },
              0
            ]
          }
        }
      },
      {
        $project: {
          totalUnitsProduced: 1,
          totalDefectiveUnits: 1,
          totalRunningMinutes: 1,
          totalStoppageMinutes: 1,
          totalStoppages: 1,
          breakdownStoppages: 1,
          totalBreakdownMinutes: 1,
          availability: { $round: [{ $multiply: ['$availability', 100] }, 0] },
          quality: { $round: [{ $multiply: ['$quality', 100] }, 0] },
          performance: { $round: [{ $multiply: ['$performance', 100] }, 0] },
          mtbf: { $round: ['$mtbf', 0] },
          mttr: { $round: ['$mttr', 0] },
          oee: {
            $round: [
              { $multiply: ['$availability', '$quality', '$performance', 10000] },
              0
            ]
          }
        }
      }
    ];
  }

  // Optimized department stats aggregation
  static getDepartmentStatsAggregation(departmentId, startDate, endDate) {
    return [
      {
        $lookup: {
          from: 'machines',
          localField: 'machineId',
          foreignField: '_id',
          as: 'machine'
        }
      },
      {
        $match: {
          'machine.departmentId': new mongoose.Types.ObjectId(departmentId),
          'machine.isActive': true,
          startTime: { $gte: startDate, $lte: endDate }
        }
      },
      {
        $unwind: {
          path: '$hourlyData',
          preserveNullAndEmptyArrays: true
        }
      },
      {
        $lookup: {
          from: 'molds',
          localField: 'hourlyData.moldId',
          foreignField: '_id',
          as: 'moldInfo'
        }
      },
      {
        $group: {
          _id: '$machineId',
          totalRunningMinutes: { $sum: '$hourlyData.runningMinutes' },
          totalStoppageMinutes: { $sum: '$hourlyData.stoppageMinutes' },
          totalUnitsProduced: { $sum: '$unitsProduced' },
          totalDefectiveUnits: { $sum: '$defectiveUnits' },
          totalExpectedUnits: {
            $sum: {
              $multiply: [
                { $divide: [{ $arrayElemAt: ['$moldInfo.productionCapacityPerHour', 0] }, 60] },
                '$hourlyData.runningMinutes'
              ]
            }
          }
        }
      },
      {
        $project: {
          oee: {
            $let: {
              vars: {
                availability: {
                  $cond: [
                    { $gt: [{ $add: ['$totalRunningMinutes', '$totalStoppageMinutes'] }, 0] },
                    { $divide: ['$totalRunningMinutes', { $add: ['$totalRunningMinutes', '$totalStoppageMinutes'] }] },
                    0
                  ]
                },
                quality: {
                  $cond: [
                    { $gt: ['$totalUnitsProduced', 0] },
                    { $divide: [{ $subtract: ['$totalUnitsProduced', '$totalDefectiveUnits'] }, '$totalUnitsProduced'] },
                    0
                  ]
                },
                performance: {
                  $cond: [
                    { $gt: ['$totalExpectedUnits', 0] },
                    { $divide: ['$totalUnitsProduced', '$totalExpectedUnits'] },
                    0
                  ]
                }
              },
              in: {
                $round: [
                  { $multiply: ['$$availability', '$$quality', '$$performance', 100] },
                  0
                ]
              }
            }
          }
        }
      },
      {
        $group: {
          _id: null,
          avgOEE: { $avg: '$oee' },
          machineCount: { $sum: 1 }
        }
      },
      {
        $project: {
          avgOEE: { $round: ['$avgOEE', 0] }
        }
      }
    ];
  }

  // Batch machine stats calculation
  static getBatchMachineStatsAggregation(machineIds, startDate, endDate) {
    return [
      {
        $match: {
          machineId: { $in: machineIds.map(id => new mongoose.Types.ObjectId(id)) },
          startTime: { $gte: startDate, $lte: endDate }
        }
      },
      {
        $unwind: {
          path: '$hourlyData',
          preserveNullAndEmptyArrays: true
        }
      },
      {
        $lookup: {
          from: 'molds',
          localField: 'hourlyData.moldId',
          foreignField: '_id',
          as: 'moldInfo'
        }
      },
      {
        $group: {
          _id: '$machineId',
          totalUnitsProduced: { $sum: '$unitsProduced' },
          totalDefectiveUnits: { $sum: '$defectiveUnits' },
          totalRunningMinutes: { $sum: '$hourlyData.runningMinutes' },
          totalStoppageMinutes: { $sum: '$hourlyData.stoppageMinutes' },
          totalStoppages: { $sum: { $size: { $ifNull: ['$hourlyData.stoppages', []] } } },
          breakdownStoppages: {
            $sum: {
              $size: {
                $filter: {
                  input: { $ifNull: ['$hourlyData.stoppages', []] },
                  cond: { $eq: ['$$this.reason', 'breakdown'] }
                }
              }
            }
          },
          totalBreakdownMinutes: {
            $sum: {
              $reduce: {
                input: { $ifNull: ['$hourlyData.stoppages', []] },
                initialValue: 0,
                in: {
                  $cond: [
                    { $eq: ['$$this.reason', 'breakdown'] },
                    { $add: ['$$value', { $ifNull: ['$$this.duration', 0] }] },
                    '$$value'
                  ]
                }
              }
            }
          },
          totalExpectedUnits: {
            $sum: {
              $multiply: [
                { $divide: [{ $arrayElemAt: ['$moldInfo.productionCapacityPerHour', 0] }, 60] },
                '$hourlyData.runningMinutes'
              ]
            }
          }
        }
      },
      {
        $project: {
          machineId: '$_id',
          totalUnitsProduced: 1,
          totalDefectiveUnits: 1,
          totalRunningMinutes: 1,
          totalStoppageMinutes: 1,
          totalStoppages: 1,
          breakdownStoppages: 1,
          totalBreakdownMinutes: 1,
          availability: {
            $cond: [
              { $gt: [{ $add: ['$totalRunningMinutes', '$totalStoppageMinutes'] }, 0] },
              {
                $round: [
                  { $multiply: [
                    { $divide: ['$totalRunningMinutes', { $add: ['$totalRunningMinutes', '$totalStoppageMinutes'] }] },
                    100
                  ] },
                  0
                ]
              },
              0
            ]
          },
          quality: {
            $cond: [
              { $gt: ['$totalUnitsProduced', 0] },
              {
                $round: [
                  { $multiply: [
                    { $divide: [{ $subtract: ['$totalUnitsProduced', '$totalDefectiveUnits'] }, '$totalUnitsProduced'] },
                    100
                  ] },
                  0
                ]
              },
              0
            ]
          },
          performance: {
            $cond: [
              { $gt: ['$totalExpectedUnits', 0] },
              {
                $round: [
                  { $multiply: [{ $divide: ['$totalUnitsProduced', '$totalExpectedUnits'] }, 100] },
                  0
                ]
              },
              0
            ]
          },
          mtbf: {
            $cond: [
              { $gt: ['$breakdownStoppages', 0] },
              { $round: [{ $divide: ['$totalRunningMinutes', '$breakdownStoppages'] }, 0] },
              0
            ]
          },
          mttr: {
            $cond: [
              { $gt: ['$breakdownStoppages', 0] },
              { $round: [{ $divide: ['$totalBreakdownMinutes', '$breakdownStoppages'] }, 0] },
              0
            ]
          }
        }
      },
      {
        $addFields: {
          oee: {
            $round: [
              { $multiply: [
                { $divide: ['$availability', 100] },
                { $divide: ['$quality', 100] },
                { $divide: ['$performance', 100] },
                100
              ] },
              0
            ]
          }
        }
      }
    ];
  }

  // Optimized unclassified stoppages count
  static getUnclassifiedStoppagesCountAggregation() {
    return [
      {
        $unwind: '$hourlyData'
      },
      {
        $unwind: '$hourlyData.stoppages'
      },
      {
        $match: {
          'hourlyData.stoppages.reason': 'unclassified'
        }
      },
      {
        $count: 'total'
      }
    ];
  }

  // Optimized factory stats aggregation
  static getFactoryStatsAggregation(startDate, endDate) {
    return [
      {
        $match: {
          startTime: { $gte: startDate, $lte: endDate }
        }
      },
      {
        $lookup: {
          from: 'machines',
          localField: 'machineId',
          foreignField: '_id',
          as: 'machine'
        }
      },
      {
        $unwind: '$machine'
      },
      {
        $match: {
          'machine.isActive': true
        }
      },
      {
        $unwind: {
          path: '$hourlyData',
          preserveNullAndEmptyArrays: true
        }
      },
      {
        $lookup: {
          from: 'molds',
          localField: 'hourlyData.moldId',
          foreignField: '_id',
          as: 'moldInfo'
        }
      },
      {
        $group: {
          _id: '$machineId',
          machineName: { $first: '$machine.name' },
          machineStatus: { $first: '$machine.status' },
          totalUnitsProduced: { $sum: '$unitsProduced' },
          totalRunningMinutes: { $sum: '$hourlyData.runningMinutes' },
          totalStoppageMinutes: { $sum: '$hourlyData.stoppageMinutes' },
          totalExpectedUnits: {
            $sum: {
              $multiply: [
                { $divide: [{ $arrayElemAt: ['$moldInfo.productionCapacityPerHour', 0] }, 60] },
                '$hourlyData.runningMinutes'
              ]
            }
          },
          totalDefectiveUnits: { $sum: '$defectiveUnits' }
        }
      },
      {
        $project: {
          machineName: 1,
          machineStatus: 1,
          totalUnitsProduced: 1,
          oee: {
            $let: {
              vars: {
                availability: {
                  $cond: [
                    { $gt: [{ $add: ['$totalRunningMinutes', '$totalStoppageMinutes'] }, 0] },
                    { $divide: ['$totalRunningMinutes', { $add: ['$totalRunningMinutes', '$totalStoppageMinutes'] }] },
                    0
                  ]
                },
                quality: {
                  $cond: [
                    { $gt: ['$totalUnitsProduced', 0] },
                    { $divide: [{ $subtract: ['$totalUnitsProduced', '$totalDefectiveUnits'] }, '$totalUnitsProduced'] },
                    0
                  ]
                },
                performance: {
                  $cond: [
                    { $gt: ['$totalExpectedUnits', 0] },
                    { $divide: ['$totalUnitsProduced', '$totalExpectedUnits'] },
                    0
                  ]
                }
              },
              in: {
                $round: [
                  { $multiply: ['$$availability', '$$quality', '$$performance', 100] },
                  0
                ]
              }
            }
          }
        }
      },
      {
        $group: {
          _id: null,
          totalUnits: { $sum: '$totalUnitsProduced' },
          avgOEE: { $avg: '$oee' },
          activeMachines: {
            $sum: {
              $cond: [{ $eq: ['$machineStatus', 'running'] }, 1, 0]
            }
          },
          totalMachines: { $sum: 1 }
        }
      },
      {
        $project: {
          totalUnits: 1,
          avgOEE: { $round: ['$avgOEE', 0] },
          activeMachines: 1,
          totalMachines: 1
        }
      }
    ];
  }
}

module.exports = AggregationHelper;