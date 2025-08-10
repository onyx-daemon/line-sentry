const express = require('express');
const Config = require('../models/Config');
const { auth, adminAuth } = require('../middleware/auth');

const router = express.Router();

// Route for fetching shift details (accessible to any authenticated user) - Optimized
router.get('/shifts', auth, async (req, res) => {
  try {
    const config = await Config.findOne()
      .select('shifts')
      .lean();
      
    res.json(config?.shifts || []);
  } catch (error) { 
    console.error('Shift config fetch error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get configuration - Optimized
router.get('/', auth, adminAuth, async (req, res) => {
  try {
    let config = await Config.findOne().lean();
    
    if (!config) {
      // Create default config if none exists
      const defaultConfig = new Config();
      config = await defaultConfig.save();
    }
    
    res.json(config);
  } catch (error) { 
    console.error('Config fetch error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Update configuration - Optimized
router.put('/', auth, adminAuth, async (req, res) => {
  try {
    const configData = req.body;
    
    // Validate configuration data
    if (configData.plc) {
      const { ip, rack, slot } = configData.plc;
      if (ip && !/^(\d{1,3}\.){3}\d{1,3}$/.test(ip)) {
        return res.status(400).json({ message: 'Invalid IP address format' });
      }
      if (rack !== undefined && (rack < 0 || rack > 7)) {
        return res.status(400).json({ message: 'Rack must be between 0 and 7' });
      }
      if (slot !== undefined && (slot < 0 || slot > 31)) {
        return res.status(400).json({ message: 'Slot must be between 0 and 31' });
      }
    }

    if (configData.signalTimeouts) {
      const { powerSignalTimeout, cycleSignalTimeout } = configData.signalTimeouts;
      if (powerSignalTimeout !== undefined && (powerSignalTimeout < 1 || powerSignalTimeout > 60)) {
        return res.status(400).json({ message: 'Power signal timeout must be between 1 and 60 minutes' });
      }
      if (cycleSignalTimeout !== undefined && (cycleSignalTimeout < 1 || cycleSignalTimeout > 60)) {
        return res.status(400).json({ message: 'Cycle signal timeout must be between 1 and 60 minutes' });
      }
    }

    // Use findOneAndUpdate with upsert for better performance
    const config = await Config.findOneAndUpdate(
      {}, // Empty filter to match any document
      configData,
      { 
        new: true, 
        upsert: true,
        runValidators: true,
        setDefaultsOnInsert: true
      }
    );
    
    res.json(config);
  } catch (error) {
    console.error('Config update error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;