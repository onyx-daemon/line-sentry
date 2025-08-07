const express = require('express');
const Config = require('../models/Config');
const { auth, adminAuth } = require('../middleware/auth');
const cacheManager = require('../utils/cache');

const router = express.Router();

// Route for fetching shift details (optimized with caching)
router.get('/shifts', auth, async (req, res) => {
  try {
    // Try cache first
    let config = cacheManager.getConfig();
    
    if (!config) {
      config = await Config.findOne().select('shifts -_id').lean();
      if (config) {
        cacheManager.setConfig(config);
      }
    }
    
    if (!config) {
      return res.json({ shifts: [] });
    }
    
    res.json(config.shifts || []);
  } catch (error) { 
    console.error('Shift config fetch error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get configuration (optimized with caching)
router.get('/', auth, adminAuth, async (req, res) => {
  try {
    // Try cache first
    let config = cacheManager.getConfig();
    
    if (!config) {
      config = await Config.findOne().lean();
      if (!config) {
        config = new Config(); // Will use schema defaults
        await config.save();
        config = config.toObject();
      }
      
      // Cache the config
      cacheManager.setConfig(config);
    }
    
    res.json(config);
  } catch (error) { 
    console.error('Config fetch error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Update configuration (optimized)
router.put('/', auth, adminAuth, async (req, res) => {
  try {
    const configData = req.body;
    
    const config = await Config.findOneAndUpdate(
      {},
      configData,
      { 
        new: true, 
        upsert: true,
        runValidators: true
      }
    ).lean();
    
    // Update cache
    cacheManager.setConfig(config);
    
    res.json(config);
  } catch (error) {
    console.error('Config update error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;