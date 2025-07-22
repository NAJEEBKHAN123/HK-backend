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
        error: 'Name, email and password are required'
      });
    }

    if (!validator.isEmail(email)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid email format'
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        error: 'Password must be at least 8 characters'
      });
    }

    // Check for existing client
    const existingClient = await Client.findOne({ email });
    if (existingClient) {
      return res.status(409).json({
        success: false,
        error: 'Email already registered'
      });
    }

    // Initialize client data
    const clientData = {
      name,
      email,
      password,
      source: 'DIRECT', // Default
      referredBy: null,
      referralCode: null
    };

    // Handle referral if code provided
    if (referralCode) {
      const partner = await Partner.findOne({ 
        referralCode,
        status: 'active'
      });

      if (partner) {
        clientData.source = 'REFERRAL';
        clientData.referredBy = partner._id;
        clientData.referralCode = referralCode;

        // Track referral click
        await Partner.findByIdAndUpdate(partner._id, {
          $inc: { referralClicks: 1 }
        });
      }
    }

    // Create client
    const client = await Client.create(clientData);

    // Update partner if referral
    if (client.source === 'REFERRAL') {
      await Partner.findByIdAndUpdate(client.referredBy, {
        $addToSet: { clientsReferred: client._id }
      });
    }

    // Create JWT
    const token = jwt.sign(
      { 
        id: client._id, 
        role: 'client',
        source: client.source 
      },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.status(201).json({
      success: true,
      token,
      client: {
        id: client._id,
        name: client.name,
        email: client.email,
        source: client.source,
        referralCode: client.referralCode
      }
    });

  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({
      success: false,
      error: 'Registration failed'
    });
  }
};

exports.clientLogin = async (req, res) => {
  try {
    const { email, password } = req.body;

    const client = await Client.findOne({ email }).select('+password');
    if (!client) {
      return res.status(401).json({ 
        success: false,
        error: 'Invalid credentials'
      });
    }

    const isMatch = await client.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials'
      });
    }

    const token = jwt.sign(
      { 
        id: client._id, 
        role: 'client',
        source: client.source 
      },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.json({
      success: true,
      token,
      client: {
        id: client._id,
        name: client.name,
        email: client.email,
        source: client.source
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Login failed'
    });
  }
};