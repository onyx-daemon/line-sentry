const mongoose = require('mongoose');

const reportSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['daily', 'weekly', 'monthly', 'yearly'],
    required: true
  },
  period: {
    start: { type: Date, required: true },
    end: { type: Date, required: true }
  },
  departmentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Department'
  },
  machineId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Machine'
  },
  metrics: {
    oee: { type: Number, default: 0 },
    mttr: { type: Number, default: 0 }, // in minutes
    mtbf: { type: Number, default: 0 }, // in minutes
    availability: { type: Number, default: 0 },
    quality: { type: Number, default: 0 },
    performance: { type: Number, default: 0 },
    totalUnitsProduced: { type: Number, default: 0 },
    totalDefectiveUnits: { type: Number, default: 0 },
    totalRunningMinutes: { type: Number, default: 0 },
    totalStoppageMinutes: { type: Number, default: 0 },
    totalStoppages: { type: Number, default: 0 }
  },
   machineData: [{
    machineId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Machine',
      required: true
    },
    machineName: String,
    metrics: {
      oee: Number,
      mtbf: Number,
      mttr: Number,
      availability: Number,
      quality: Number,
      performance: Number,
      totalUnitsProduced: Number,
      totalDefectiveUnits: Number,
      totalRunningMinutes: Number,
      totalStoppageMinutes: Number,
      totalStoppages: Number
    }
  }],
  departmentData: [{
  departmentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Department',
    required: true
  },
  departmentName: String,
  metrics: {
    oee: Number,
    mtbf: Number,
    mttr: Number,
    availability: Number,
    quality: Number,
    performance: Number,
    totalUnitsProduced: Number,
    totalDefectiveUnits: Number,
    totalRunningMinutes: Number,
    totalStoppageMinutes: Number,
    totalStoppages: Number
  }
  }],
  shiftData: [{
    shiftName: String,
    startTime: String,
    endTime: String,
    metrics: {
      oee: Number,
      unitsProduced: Number,
      defectiveUnits: Number,
      runningMinutes: Number,
      stoppageMinutes: Number
    }
  }],
  generatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  emailSent: { type: Boolean, default: false },
  emailSentAt: Date
}, {
  timestamps: true
});

module.exports = mongoose.model('Report', reportSchema);