const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Department = require('../models/Department');
const { auth } = require('../middleware/auth');
const bcrypt = require('bcryptjs');
const axios = require('axios');

const router = express.Router();

// CAPTCHA verification function
const verifyCaptcha = async (token) => {
  if (!token) return false;
  
  try {
    const response = await axios.post('https://www.google.com/recaptcha/api/siteverify', null, {
      params: {
        secret: process.env.RECAPTCHA_SECRET_KEY || '6LeIxAcTAAAAAGG-vFI1TnRWxMZNFuojJ4WifJWe', // Test secret
        response: token
      }
    });
    
    return response.data.success;
  } catch (error) {
    console.error('CAPTCHA verification error:', error);
    return false;
  }
};
// Login
router.post('/login', async (req, res) => {
  try {
    const { username, password, captchaToken } = req.body;

    // Verify CAPTCHA if provided
    if (captchaToken) {
      const captchaValid = await verifyCaptcha(captchaToken);
      if (!captchaValid) {
        return res.status(400).json({ message: 'Invalid CAPTCHA verification' });
      }
    }

    const user = await User.findOne({ username }).populate('departmentId');
    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    if (!user.isActive) {
      return res.status(401).json({ message: 'Account is deactivated' });
    }

    const token = jwt.sign(
      { userId: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        role: user.role,
        department: user.departmentId
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get current user
router.get('/me', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
      .populate('departmentId')
      .select('-password')
      .lean();
    res.json(user);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Initialize demo accounts
router.post('/init-demo', async (req, res) => {
  try {
    // Create demo department
    const demoDept = await Department.findOneAndUpdate(
      { name: 'Manufacturing Department' },
      {
        name: 'Manufacturing Department',
        description: 'Main manufacturing department with injection molding machines'
      },
      { upsert: true, new: true }
    );

    const adminPassword = await bcrypt.hash('admin123', 12);
    const operatorPassword = await bcrypt.hash('operator123', 12);

    // Create demo admin
    await User.findOneAndUpdate(
      { username: 'admin' },
      {
        username: 'admin',
        email: 'admin@company.com',
        password: adminPassword,
        role: 'admin',
        isActive: true
      },
      { upsert: true, new: true }
    );

    // Create demo operator
    await User.findOneAndUpdate(
      { username: 'operator' },
      {
        username: 'operator',
        email: 'operator@company.com',
        password: operatorPassword,
        role: 'operator',
        departmentId: demoDept._id,
        isActive: true
      },
      { upsert: true, new: true }
    );

    res.json({ message: 'Demo accounts initialized successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Error initializing demo accounts', error: error.message });
  }
});

module.exports = router;