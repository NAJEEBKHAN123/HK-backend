const Client = require('../model/Client');
const Partner = require('../model/Partner');
const jwt = require('jsonwebtoken');
const validator = require('validator');

exports.clientSignup = async (req, res) => {
  try {
    const { name, email, password, referralCode } = req.body;

    // Validation
    if (!name || !email || !password) {
      return res.status(400).json({ 
        success: false,
        error: 'Name, email and password are required',
        code: 'MISSING_FIELDS'
      });
    }

    if (!validator.isEmail(email)) {
      return res.status(400).json({
        success: false,
        error: 'Please provide a valid email address',
        code: 'INVALID_EMAIL'
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        error: 'Password must be at least 8 characters',
        code: 'WEAK_PASSWORD'
      });
    }

    // Check for existing client
    const existingClient = await Client.findOne({ email });
    if (existingClient) {
      return res.status(409).json({
        success: false,
        error: 'Email already registered',
        code: 'EMAIL_EXISTS'
      });
    }

    // Prepare client data
    const clientData = {
      name,
      email,
      password
    };

    // Handle referral code
    if (referralCode) {
      const referringPartner = await Partner.findOne({ 
        referralCode,
        status: 'active'
      });
      
      if (referringPartner) {
        clientData.referredBy = referringPartner._id;
        clientData.source = 'REFERRAL';
        clientData.referralCode = referralCode;
      }
    }

    // Create the client first
    const client = await Client.create(clientData);

    // Then update the partner's data
    if (referralCode && client.referredBy) {
      await Partner.findByIdAndUpdate(client.referredBy, {
        $addToSet: { clientsReferred: client._id },
        $inc: { referralClicks: 1 }
      });
    }

    // Create JWT
    const token = jwt.sign(
      { id: client._id, role: 'client' },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    res.status(201).json({
      success: true,
      token,
      client: {
        id: client._id,
        name: client.name,
        email: client.email
      },
      redirectUrl: '/pricingCards'
    });

  } catch (error) {
    console.error('Signup error:', error.stack);
    res.status(500).json({
      success: false,
      error: 'Registration failed',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};



exports.clientLogin = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Find client
    const client = await Client.findOne({ email }).select('+password');
    if (!client) {
      return res.status(401).json({ 
        success: false,
        error: 'Invalid credentials',
        code: 'INVALID_CREDENTIALS'
      });
    }

    // Check password
    const isMatch = await client.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials',
        code: 'INVALID_CREDENTIALS'
      });
    }

    // Generate token
    const token = jwt.sign(
      { id: client._id, role: 'client' },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    res.json({
      success: true,
      token,
      client: {
        id: client._id,
        name: client.name,
        email: client.email
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Login failed'
    });
  }
};

