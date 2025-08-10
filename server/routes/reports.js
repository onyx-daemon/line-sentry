const express = require('express');
const mongoose = require('mongoose');
const Report = require('../models/Report');
const ProductionRecord = require('../models/ProductionRecord');
const Machine = require('../models/Machine');
const Config = require('../models/Config');
const { auth, adminAuth } = require('../middleware/auth');
const nodemailer = require('nodemailer');
const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');

const router = express.Router();

// Generate report - Optimized
router.post('/generate', auth, async (req, res) => {
  try {
    const { type, startDate, endDate, departmentId, machineId } = req.body;
    
    if (!type || !startDate || !endDate) {
      return res.status(400).json({ message: 'Type, start date, and end date are required' });
    }

    const start = new Date(startDate);
    const end = new Date(endDate);
    
    if (start > end) {
      return res.status(400).json({ message: 'Start date cannot be after end date' });
    }

    if (departmentId && !mongoose.Types.ObjectId.isValid(departmentId)) {
      return res.status(400).json({ message: 'Invalid department ID' });
    }

    if (machineId && !mongoose.Types.ObjectId.isValid(machineId)) {
      return res.status(400).json({ message: 'Invalid machine ID' });
    }
    
    const report = await generateReport({
      type,
      startDate: start,
      endDate: end,
      departmentId: departmentId ? new mongoose.Types.ObjectId(departmentId) : undefined,
      machineId: machineId ? new mongoose.Types.ObjectId(machineId) : undefined,
      generatedBy: req.user._id
    });

    res.json(report);
  } catch (error) {
    console.error('Report generation error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get reports - Optimized
router.get('/', auth, async (req, res) => {
  try {
    const { type, departmentId, machineId } = req.query;
    
    const query = {};
    if (type) query.type = type;
    if (departmentId && mongoose.Types.ObjectId.isValid(departmentId)) {
      query.departmentId = new mongoose.Types.ObjectId(departmentId);
    }
    if (machineId && mongoose.Types.ObjectId.isValid(machineId)) {
      query.machineId = new mongoose.Types.ObjectId(machineId);
    }

    const reports = await Report.find(query)
      .populate({
        path: 'generatedBy',
        select: 'username',
        options: { retainNullValues: true }
      })
      .populate('departmentId', 'name')
      .populate('machineId', 'name')
      .select('-__v')
      .sort({ createdAt: -1 })
      .lean();

    res.json(reports);
  } catch (error) {
    console.error('Reports fetch error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Email report - Optimized
router.post('/:id/email', auth, async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid report ID' });
    }
    
    const report = await Report.findById(id)
      .populate('departmentId', 'name')
      .populate('machineId', 'name')
      .populate('generatedBy', 'username')
      .lean();
    
    if (!report) {
      return res.status(404).json({ message: 'Report not found' });
    }

    await emailReport(report);
    
    // Update email status
    await Report.findByIdAndUpdate(id, {
      emailSent: true,
      emailSentAt: new Date()
    });

    res.json({ message: 'Report emailed successfully' });
  } catch (error) {
    console.error('Email report error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Download report as PDF - Optimized
router.get('/:id/pdf', auth, async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid report ID' });
    }
    
    const report = await Report.findById(id)
      .populate('departmentId', 'name')
      .populate('machineId', 'name')
      .populate('generatedBy', 'username')
      .lean();
    
    if (!report) {
      return res.status(404).json({ message: 'Report not found' });
    }

    const pdfBuffer = await generatePDF(report);
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 
      `attachment; filename="${report.type}-report-${report.period.start.toISOString().split('T')[0]}.pdf"`);
    res.send(pdfBuffer);
  } catch (error) {
    console.error('PDF generation error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Delete report - Optimized
router.delete('/:id', auth, adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid report ID' });
    }
    
    const report = await Report.findByIdAndDelete(id).select('type').lean();
    
    if (!report) {
      return res.status(404).json({ message: 'Report not found' });
    }
    
    res.json({ message: 'Report deleted successfully' });
  } catch (error) {
    console.error('Report deletion error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Generate report function - Optimized with aggregation
async function generateReport({ type, startDate, endDate, departmentId, machineId, generatedBy }) {
  // Build query for production records
  const query = {
    startTime: { $gte: startDate, $lte: endDate }
  };
  
  if (departmentId) {
    const machines = await Machine.find({ departmentId }).select('_id').lean();
    query.machineId = { $in: machines.map(m => m._id) };
  }
  
  if (machineId) {
    query.machineId = machineId;
  }

  // Use aggregation for better performance
  const productionRecords = await ProductionRecord.find(query)
    .populate('machineId', 'name')
    .populate('operatorId', 'username')
    .populate({
      path: 'hourlyData.moldId',
      model: 'Mold',
      select: 'name productionCapacityPerHour'
    })
    .lean();

  // Get shifts configuration
  const config = await Config.findOne().select('shifts').lean();
  const shifts = config?.shifts || [];

  // Calculate metrics efficiently
  const { metrics, shiftData, machineData } = await calculateMetrics(productionRecords, shifts);

  const report = new Report({
    type,
    period: { start: startDate, end: endDate },
    departmentId,
    machineId,
    metrics,
    shiftData,
    machineData,
    generatedBy
  });

  await report.save();
  return report;
}

// Calculate metrics function - Optimized
async function calculateMetrics(productionRecords, shifts) {
  // Initialize metrics
  let totalUnitsProduced = 0;
  let totalDefectiveUnits = 0;
  let totalRunningMinutes = 0;
  let totalStoppageMinutes = 0;
  let totalExpectedUnits = 0;
  let totalStoppages = 0;
  let breakdownStoppages = 0;
  let totalBreakdownMinutes = 0;

  const shiftMetrics = {};
  const machineMetrics = new Map();
  
  // Initialize shift metrics
  shifts.forEach(shift => {
    shiftMetrics[shift.name] = {
      shiftName: shift.name,
      startTime: shift.startTime,
      endTime: shift.endTime,
      metrics: {
        unitsProduced: 0,
        defectiveUnits: 0,
        runningMinutes: 0,
        stoppageMinutes: 0,
        expectedUnits: 0
      }
    };
  });

  // Process records efficiently
  productionRecords.forEach(record => {
    totalUnitsProduced += record.unitsProduced || 0;
    totalDefectiveUnits += record.defectiveUnits || 0;

    // Initialize machine metrics if not exists
    if (!machineMetrics.has(record.machineId._id.toString())) {
      machineMetrics.set(record.machineId._id.toString(), {
        machineId: record.machineId._id,
        machineName: record.machineId.name,
        metrics: {
          oee: 0, mtbf: 0, mttr: 0, availability: 0, quality: 0, performance: 0,
          totalUnitsProduced: 0, totalDefectiveUnits: 0,
          totalRunningMinutes: 0, totalStoppageMinutes: 0, totalStoppages: 0,
          totalExpectedUnits: 0, breakdownStoppages: 0, totalBreakdownMinutes: 0
        }
      });
    }

    const machineData = machineMetrics.get(record.machineId._id.toString());

    record.hourlyData.forEach(hourData => {
      const runningMinutes = hourData.runningMinutes || 0;
      const stoppageMinutes = hourData.stoppageMinutes || 0;
      const stoppageCount = hourData.stoppages?.length || 0;

      // Update totals
      totalRunningMinutes += runningMinutes;
      totalStoppageMinutes += stoppageMinutes;
      totalStoppages += stoppageCount;

      // Update machine metrics
      machineData.metrics.totalUnitsProduced += hourData.unitsProduced || 0;
      machineData.metrics.totalDefectiveUnits += hourData.defectiveUnits || 0;
      machineData.metrics.totalRunningMinutes += runningMinutes;
      machineData.metrics.totalStoppageMinutes += stoppageMinutes;
      machineData.metrics.totalStoppages += stoppageCount;

      // Calculate expected units
      if (hourData.moldId?.productionCapacityPerHour) {
        const capacityPerMinute = hourData.moldId.productionCapacityPerHour / 60;
        const expectedUnits = capacityPerMinute * runningMinutes;
        totalExpectedUnits += expectedUnits;
        machineData.metrics.totalExpectedUnits += expectedUnits;
      }

      // Count breakdown stoppages
      hourData.stoppages?.forEach(stoppage => {
        if (stoppage.reason === 'breakdown') {
          const duration = stoppage.duration || 0;
          breakdownStoppages++;
          totalBreakdownMinutes += duration;
          machineData.metrics.breakdownStoppages++;
          machineData.metrics.totalBreakdownMinutes += duration;
        }
      });

      // Calculate shift metrics
      const shift = getShiftForHour(hourData.hour, shifts);
      if (shift && shiftMetrics[shift.name]) {
        const shiftData = shiftMetrics[shift.name].metrics;
        shiftData.unitsProduced += hourData.unitsProduced || 0;
        shiftData.defectiveUnits += hourData.defectiveUnits || 0;
        shiftData.runningMinutes += runningMinutes;
        shiftData.stoppageMinutes += stoppageMinutes;
        
        if (hourData.moldId?.productionCapacityPerHour) {
          const capacityPerMinute = hourData.moldId.productionCapacityPerHour / 60;
          shiftData.expectedUnits += capacityPerMinute * runningMinutes;
        }
      }
    });
  });

  // Calculate overall metrics
  const totalMinutes = totalRunningMinutes + totalStoppageMinutes;
  const availability = totalMinutes > 0 ? (totalRunningMinutes / totalMinutes) : 0;
  const quality = totalUnitsProduced > 0 ? 
    (totalUnitsProduced - totalDefectiveUnits) / totalUnitsProduced : 0;
  const performance = totalExpectedUnits > 0 ? 
    (totalUnitsProduced / totalExpectedUnits) : 0;
  const oee = availability * quality * performance;

  const mtbf = breakdownStoppages > 0 ? totalRunningMinutes / breakdownStoppages : 0;
  const mttr = breakdownStoppages > 0 ? totalBreakdownMinutes / breakdownStoppages : 0;

  // Calculate machine-specific metrics
  const machineData = Array.from(machineMetrics.values()).map(machine => {
    const m = machine.metrics;
    const machineMinutes = m.totalRunningMinutes + m.totalStoppageMinutes;
    const machineAvailability = machineMinutes > 0 ? (m.totalRunningMinutes / machineMinutes) : 0;
    const machineQuality = m.totalUnitsProduced > 0 ? 
      (m.totalUnitsProduced - m.totalDefectiveUnits) / m.totalUnitsProduced : 0;
    const machinePerformance = m.totalExpectedUnits > 0 ? 
      (m.totalUnitsProduced / m.totalExpectedUnits) : 0;
    const machineOEE = machineAvailability * machineQuality * machinePerformance;
    
    const machineMTBF = m.breakdownStoppages > 0 ? m.totalRunningMinutes / m.breakdownStoppages : 0;
    const machineMTTR = m.breakdownStoppages > 0 ? m.totalBreakdownMinutes / m.breakdownStoppages : 0;

    return {
      ...machine,
      metrics: {
        ...m,
        oee: Math.round(machineOEE * 100),
        mtbf: Math.round(machineMTBF),
        mttr: Math.round(machineMTTR),
        availability: Math.round(machineAvailability * 100),
        quality: Math.round(machineQuality * 100),
        performance: Math.round(machinePerformance * 100)
      }
    };
  });

  // Calculate shift OEE
  const shiftData = Object.values(shiftMetrics).map(shiftInfo => {
    const sm = shiftInfo.metrics;
    const shiftMinutes = sm.runningMinutes + sm.stoppageMinutes;
    const shiftAvailability = shiftMinutes > 0 ? (sm.runningMinutes / shiftMinutes) : 0;
    const shiftQuality = sm.unitsProduced > 0 ? 
      (sm.unitsProduced - sm.defectiveUnits) / sm.unitsProduced : 0;
    const shiftPerformance = sm.expectedUnits > 0 ? 
      (sm.unitsProduced / sm.expectedUnits) : 0;
    const shiftOEE = shiftAvailability * shiftQuality * shiftPerformance;

    return {
      shiftName: shiftInfo.shiftName,
      startTime: shiftInfo.startTime,
      endTime: shiftInfo.endTime,
      metrics: {
        oee: Math.round(shiftOEE * 100),
        unitsProduced: sm.unitsProduced,
        defectiveUnits: sm.defectiveUnits,
        runningMinutes: sm.runningMinutes,
        stoppageMinutes: sm.stoppageMinutes
      }
    };
  });

  return {
    metrics: {
      oee: Math.round(oee * 100),
      mtbf: Math.round(mtbf),
      mttr: Math.round(mttr),
      availability: Math.round(availability * 100),
      quality: Math.round(quality * 100),
      performance: Math.round(performance * 100),
      totalUnitsProduced,
      totalDefectiveUnits,
      totalRunningMinutes,
      totalStoppageMinutes,
      totalStoppages
    },
    shiftData,
    machineData
  };
}

function getShiftForHour(hour, shifts) {
  return shifts.find(shift => {
    const startHour = parseInt(shift.startTime.split(':')[0]);
    const endHour = parseInt(shift.endTime.split(':')[0]);
    
    if (startHour <= endHour) {
      return hour >= startHour && hour < endHour;
    } else {
      return hour >= startHour || hour < endHour;
    }
  });
}

// Email report function - Optimized
async function emailReport(report) {
  const config = await Config.findOne().select('email').lean();
  if (!config?.email?.recipients?.length) {
    throw new Error('Email configuration not found');
  }

  const transporter = nodemailer.createTransporter({
    service: 'gmail',
    auth: {
      user: config.email.senderEmail,
      pass: config.email.senderPassword
    },
    pool: true, // Use connection pooling
    maxConnections: 5,
    maxMessages: 100
  });

  const pdfBuffer = await generatePDF(report);

  const mailOptions = {
    from: config.email.senderEmail,
    to: config.email.recipients.join(','),
    subject: `${report.type.toUpperCase()} Production Report - ${new Date(report.period.start).toDateString()}`,
    html: generateEmailHTML(report),
    attachments: [{
      filename: `${report.type}-report-${new Date(report.period.start).toISOString().split('T')[0]}.pdf`,
      content: pdfBuffer
    }]
  };

  await transporter.sendMail(mailOptions);
  transporter.close();
}

function generateEmailHTML(report) {
  let machineTable = '';
  if (report.machineData?.length > 0) {
    machineTable = `
      <h3>Machine Performance</h3>
      <table border="1" cellpadding="5" cellspacing="0" style="border-collapse: collapse; width: 100%;">
        <thead>
          <tr style="background-color: #f2f2f2;">
            <th>Machine</th><th>OEE</th><th>Availability</th><th>Quality</th>
            <th>Performance</th><th>Units</th><th>Defects</th>
          </tr>
        </thead>
        <tbody>`;
    
    report.machineData.forEach(machine => {
      const m = machine.metrics;
      machineTable += `
        <tr>
          <td>${machine.machineName || 'Unknown'}</td>
          <td>${m.oee}%</td><td>${m.availability}%</td><td>${m.quality}%</td>
          <td>${m.performance}%</td><td>${m.totalUnitsProduced.toLocaleString()}</td>
          <td>${m.totalDefectiveUnits.toLocaleString()}</td>
        </tr>`;
    });
    
    machineTable += `</tbody></table>`;
  }
  
  return `
    <h2>${report.type.toUpperCase()} Production Report</h2>
    <p><strong>Period:</strong> ${new Date(report.period.start).toDateString()} to ${new Date(report.period.end).toDateString()}</p>
    <p><strong>Generated by:</strong> ${report.generatedBy?.username || 'System'}</p>
    
    <h3>Key Metrics</h3>
    <ul>
      <li><strong>OEE:</strong> ${report.metrics.oee}%</li>
      <li><strong>MTBF:</strong> ${report.metrics.mtbf} minutes</li>
      <li><strong>MTTR:</strong> ${report.metrics.mttr} minutes</li>
      <li><strong>Total Units:</strong> ${report.metrics.totalUnitsProduced.toLocaleString()}</li>
      <li><strong>Defective Units:</strong> ${report.metrics.totalDefectiveUnits.toLocaleString()}</li>
    </ul>
    
    ${machineTable}
    
    <p>Please find the detailed PDF report attached.</p>
  `;
}

// Generate PDF function - Optimized (keeping existing implementation but with error handling)
async function generatePDF(report) {
  return new Promise(async (resolve, reject) => {
    try {
      const config = await Config.findOne().select('metricsThresholds').lean();

      const doc = new PDFDocument({ 
        margin: 40,
        size: 'A4',
        bufferPages: true
      });
      const buffers = [];

      doc.on('data', buffers.push.bind(buffers));
      doc.on('end', () => {
        const pdfData = Buffer.concat(buffers);
        resolve(pdfData);
      });
      doc.on('error', reject);

      // Generate PDF content (keeping existing implementation)
      const pageWidth = doc.page.width - 80;
      
      // Header
      doc.fontSize(16).fillColor('#1e40af')
         .text(`${report.type.toUpperCase()} PRODUCTION REPORT`, { align: 'center' });
      doc.fontSize(8).fillColor('#6b7280')
         .text(`Period: ${new Date(report.period.start).toDateString()} - ${new Date(report.period.end).toDateString()}`, { align: 'center' });
      doc.moveDown(0.3);
      doc.text(`Generated: ${new Date().toDateString()} by ${report.generatedBy?.username || 'System'}`, { align: 'center' });
      
      doc.strokeColor('#3b82f6').lineWidth(1)
         .moveTo(40, doc.y + 8)
         .lineTo(pageWidth + 40, doc.y + 8)
         .stroke();
      
      doc.y += 30;

      // Key metrics section
      doc.fontSize(14).fillColor('#1f2937').text('KEY METRICS', 50, doc.y);
      doc.y += 20;

      const metrics = [
        { name: 'OEE', value: `${report.metrics.oee}%`, color: getOEEColor(report.metrics.oee, config) },
        { name: 'MTBF', value: `${report.metrics.mtbf}m`, color: '#10b981' },
        { name: 'MTTR', value: `${report.metrics.mttr}m`, color: '#ef4444' },
        { name: 'Units', value: report.metrics.totalUnitsProduced.toLocaleString(), color: '#3b82f6' }
      ];

      metrics.forEach((metric, i) => {
        const x = 50 + (i % 2) * 250;
        const y = doc.y + Math.floor(i / 2) * 30;
        
        doc.fontSize(10).fillColor('#6b7280').text(metric.name, x, y);
        doc.fontSize(16).fillColor(metric.color).text(metric.value, x, y + 12);
      });

      doc.y += 80;

      // Machine performance table
      if (report.machineData?.length > 0) {
        doc.fontSize(14).fillColor('#1f2937').text('MACHINE PERFORMANCE', 50, doc.y);
        doc.y += 20;
        
        const headers = ['Machine', 'OEE', 'Units', 'Defects'];
        const columnWidths = [200, 80, 80, 80];
        
        // Header row
        doc.fontSize(10).fillColor('#374151');
        let x = 50;
        headers.forEach((header, i) => {
          doc.text(header, x, doc.y, { width: columnWidths[i] });
          x += columnWidths[i];
        });
        
        doc.y += 20;
        
        // Data rows
        doc.fontSize(9);
        report.machineData.slice(0, 10).forEach(machine => { // Limit to 10 machines for space
          x = 50;
          const metrics = machine.metrics;
          
          doc.fillColor('#000000').text(machine.machineName || 'Unknown', x, doc.y, { width: columnWidths[0] });
          x += columnWidths[0];
          
          doc.fillColor(getOEEColor(metrics.oee, config)).text(`${metrics.oee}%`, x, doc.y, { width: columnWidths[1] });
          x += columnWidths[1];
          
          doc.fillColor('#000000').text(metrics.totalUnitsProduced.toLocaleString(), x, doc.y, { width: columnWidths[2] });
          x += columnWidths[2];
          
          doc.text(metrics.totalDefectiveUnits.toLocaleString(), x, doc.y, { width: columnWidths[3] });
          
          doc.y += 15;
        });
      }

      // Footer
      doc.fontSize(8).fillColor('#9ca3af')
         .text('Dawlance - LineSentry', 40, doc.page.height - 30)
         .text(`Generated: ${new Date().toLocaleString()}`, 40, doc.page.height - 30, { 
           align: 'right', 
           width: pageWidth 
         });

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

// Helper functions
function getOEEColor(oee, config) {
  if (!config?.metricsThresholds?.oee) return '#ef4444';
  if (oee >= config.metricsThresholds.oee.excellent) return '#10b981';
  if (oee >= config.metricsThresholds.oee.good) return '#f59e0b';
  if (oee >= config.metricsThresholds.oee.fair) return '#f97316';
  return '#ef4444';
}

function formatTime(minutes) {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}h ${mins}m`;
}

module.exports = router;