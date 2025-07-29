const Partner = require('../model/Partner');
const PartnerInvite = require('../model/PartnerInvite');
const Client = require('../model/Client');
const { sendEmail } = require('../services/partnerEmailService');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
// Generate partner invite credentials
exports.generatePartnerCredential = async (req, res) => {
  try {
    const { email } = req.body;
    
    const existingPartner = await Partner.findOne({ email });
    if (existingPartner) {
      return res.status(400).json({
        success: false,
        error: 'Partner with this email already exists',
        partnerId: existingPartner._id
      });
    }
    
    const token = crypto.randomBytes(32).toString('hex');
    const shortCode = `P-${Math.floor(1000 + Math.random() * 9000)}`;
    
    const invite = await PartnerInvite.create({
      email,
      token,
      shortCode,
      createdBy: req.admin.id,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
    });

    res.status(201).json({
      success: true,
      token,
      shortCode,
      expiresAt: invite.expiresAt
    });

  } catch (error) {
    res.status(500).json({ 
      success: false,
      error: 'Failed to generate credentials',
      details: error.message
    });
  }
};

// Register new partner
exports.registerPartner = async (req, res) => {
  try {
    const { token, shortCode, email, name, password } = req.body;

    // Validate input
    if (!token && !shortCode) {
      return res.status(400).json({
        success: false,
        error: 'Either token or shortCode is required'
      });
    }

    const existingPartner = await Partner.findOne({ email });
    if (existingPartner) {
      return res.status(400).json({
        success: false,
        error: "Email already registered",
        partnerId: existingPartner._id,
        status: existingPartner.status
      });
    }

    const invite = await PartnerInvite.findOne({
      $or: [{ token }, { shortCode }],
      used: false,
      expiresAt: { $gt: new Date() }
    });

    if (!invite) {
      return res.status(400).json({
        success: false,
        error: 'Invalid or expired credentials'
      });
    }

    const referralCode = `HKP-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const partner = await Partner.create({
      name,
      email,
      password,
      status: 'active',
      referralCode,
      referredBy: invite.createdBy
    });

    await PartnerInvite.findByIdAndUpdate(invite._id, {
      used: true,
      usedAt: new Date(),
      partnerCreated: partner._id
    });

    await sendEmail({
      to: partner.email,
      subject: 'Welcome to Our Partner Program',
      html: `
        <h2>Welcome to Our Partner Program</h2>
        <p>Your partner account has been successfully created.</p>
        <p>Your unique referral code: <strong>${partner.referralCode}</strong></p>
        <p>Your partner dashboard: <a href="${partner.referralLink}">${partner.referralLink}</a></p>
        <p>Start sharing your referral link: ${partner.referralLink}</p>
      `
    });

    res.status(201).json({
      success: true,
      message: 'Registration successful',
      partner: {
        id: partner._id,
        name: partner.name,
        email: partner.email,
        referralCode: partner.referralCode,
        referralLink: partner.referralLink,
        dashboardLink: `${process.env.FRONTEND_URL}/partner/dashboard`
      }
    });

  } catch (error) {

    console.error('Registration error:', error);
    res.status(500).json({
      success: false,
      error: 'Registration failed',
      details: error.message
    });
  }
};

// In your partnerController.js
exports.loginPartner = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validate input
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Please provide email and password'
      });
    }

    // Check if partner exists
    const partner = await Partner.findOne({ email }).select('+password');
    if (!partner) {
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials'
      });
    }

    // Check password
    const isMatch = await partner.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials'
      });
    }

    // Create token
    const token = jwt.sign(
      { id: partner._id, role: 'partner' },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRE || '30d' }
    );

    // Set cookie options
    const cookieOptions = {
      expires: new Date(
        Date.now() + (process.env.JWT_COOKIE_EXPIRE || 30) * 24 * 60 * 60 * 1000
      ),
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production'
    };

    // Send response
    res
      .status(200)
      .cookie('token', token, cookieOptions)
      .json({
        success: true,
        token,
        partner: {
          id: partner._id,
          name: partner.name,
          email: partner.email,
          referralCode: partner.referralCode
        }
      });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Login failed',
      details: error.message
    });
  }
};

// Logout partner
exports.logoutPartner = async (req, res) => {
  res.cookie('token', 'none', {
    expires: new Date(Date.now() + 10 * 1000),
    httpOnly: true
  });

  res.status(200).json({
    success: true,
    message: 'Logged out successfully'
  });
};

// Get current logged in partner
exports.getCurrentPartner = async (req, res) => {
  try {
    const partner = await Partner.findById(req.partner.id);

    if (!partner) {
      return res.status(404).json({
        success: false,
        error: 'Partner not found'
      });
    }

    res.status(200).json({
      success: true,
      partner: {
        id: partner._id,
        name: partner.name,
        email: partner.email,
        referralCode: partner.referralCode
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to fetch partner',
      details: error.message
    });
  }
};

// Verify partner invite
exports.verifyInvite = async (req, res) => {
  try {
    const { token, shortCode } = req.body;
    
    const invite = await PartnerInvite.findOne({
      $or: [{ token }, { shortCode }],
      used: false,
      expiresAt: { $gt: new Date() }
    });

    if (!invite) {
      return res.status(400).json({
        valid: false,
        error: 'Invalid or expired credentials'
      });
    }

    res.json({
      valid: true,
      email: invite.email || '',
      inviteData: {
        createdBy: invite.createdBy,
        createdAt: invite.createdAt
      }
    });
  } catch (error) {
    res.status(500).json({
      valid: false,
      error: 'Verification failed',
      details: error.message
    });
  }
};

exports.verifyPartners = async (req, res) => {
  try {
    const partner = await Partner.findById(req.partner.id)
      .select('-password')
      .lean();

    if (!partner) {
      return res.status(404).json({
        success: false,
        error: 'Partner not found'
      });
    }

    res.status(200).json({
      success: true,
      partner: {
        id: partner._id,
        name: partner.name,
        email: partner.email,
        referralCode: partner.referralCode
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Verification failed',
      details: error.message
    });
  }
};

// Verify referral code
exports.verifyReferral = async (req, res) => {
  try {
    const { code } = req.query;
    
    // Track the click
    await Partner.findOneAndUpdate(
      { referralCode: code },
      { $inc: { referralClicks: 1 } }
    );

    const partner = await Partner.findOne({ 
      referralCode: code,
      status: 'active'
    }).select('name email referralCode');

    if (!partner) {
      return res.json({ valid: false });
    }
    
    res.json({
      valid: true,
      partner: {
        name: partner.name,
        email: partner.email,
        referralCode: partner.referralCode
      }
    });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Get partner dashboard data
exports.getPartnerDashboard = async (req, res) => {
  try {
    if (!req.partner?.id) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized - No partner ID found'
      });
    }

    const partner = await Partner.findById(req.partner.id)
      .populate({
        path: 'clientsReferred',
        select: 'name email createdAt source orders',
        options: { sort: { createdAt: -1 } }
      })
      .populate({
        path: 'ordersReferred',
        select: 'plan finalPrice createdAt status',
        options: { sort: { createdAt: -1 } }
      });

    if (!partner) {
      return res.status(404).json({
        success: false,
        error: 'Partner not found'
      });
    }

    res.json({
      success: true,
      data: {
        partner: {
          id: partner._id,
          name: partner.name,
          email: partner.email,
          referralCode: partner.referralCode,
          referralLink: partner.referralLink,
          status: partner.status,
          commissionEarned: partner.commissionEarned,
          commissionPaid: partner.commissionPaid,
          availableCommission: partner.availableCommission,
          totalClientsReferred: partner.totalClientsReferred,
          totalOrdersReferred: partner.totalOrdersReferred,
          referralClicks: partner.referralClicks,
          conversionRate: partner.conversionRate,
          totalReferralSales: partner.totalReferralSales
        },
        clients: partner.clientsReferred || [],
        orders: partner.ordersReferred || []
      }
    });

  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch partner data',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};
// Request commission payout
exports.requestPayout = async (req, res) => {
  try {
    const partner = await Partner.findById(req.partner.id);
    if (!partner) {
      return res.status(404).json({
        success: false,
        error: 'Partner not found'
      });
    }

    const availableCommission = partner.availableCommission;
    if (availableCommission <= 0) {
      return res.status(400).json({
        success: false,
        error: 'No available commission for payout'
      });
    }

    // In production, integrate with Stripe/PayPal here
    partner.commissionPaid = partner.commissionEarned;
    await partner.save();

    await sendEmail({
      to: partner.email,
      subject: 'Payout Request Received',
      html: `
        <h2>Payout Request Processed</h2>
        <p>We've received your payout request for $${(availableCommission / 100).toFixed(2)}.</p>
        <p>The amount should appear in your account within 3-5 business days.</p>
      `
    });

    res.json({
      success: true,
      message: `Payout of $${(availableCommission / 100).toFixed(2)} initiated`,
      newBalance: 0
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Payout request failed',
      details: error.message
    });
  }
};


// Get all partners for admin dashboard
exports.getAllPartners = async (req, res) => {
  try {
    const { page = 1, limit = 10, search = '' } = req.query;
    const skip = (page - 1) * limit;

    const query = {};
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { referralCode: { $regex: search, $options: 'i' } }
      ];
    }

    const partners = await Partner.find(query)
      .select('name email referralCode status createdAt commissionEarned commissionPaid totalClientsReferred referralClicks')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Partner.countDocuments(query);

    res.json({
      success: true,
      count: partners.length,
      total,
      page: Number(page),
      pages: Math.ceil(total / limit),
      partners
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to fetch partners'
    });
  }
};

// Get detailed partner info for admin
// In partnerController.js
exports.getAdminPartnerDetails = async (req, res) => {
  try {
    if (!req.admin?.id) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized - Admin access required'
      });
    }

    // Get the partner document without lean first
    const partnerDoc = await Partner.findById(req.params.id)
      .populate('clientsReferred', 'name email createdAt')
      .populate('ordersReferred', 'plan finalPrice createdAt');

    if (!partnerDoc) {
      return res.status(404).json({
        success: false,
        error: 'Partner not found'
      });
    }

    // Convert to object and manually add virtuals if needed
    const partner = partnerDoc.toObject({ virtuals: true });

    // Calculate virtuals manually as fallback
    const totalClientsReferred = partner.clientsReferred?.length || 0;
    const totalOrdersReferred = partner.ordersReferred?.length || 0;
    const conversionRate = partner.referralClicks > 0 
      ? parseFloat(((totalClientsReferred / partner.referralClicks) * 100).toFixed(2))
      : 0;

    res.json({
      success: true,
      partner: {
        id: partner._id,
        name: partner.name,
        email: partner.email,
        referralCode: partner.referralCode,
        referralLink: partner.referralLink,
        status: partner.status,
        commissionEarned: partner.commissionEarned || 0,
        commissionPaid: partner.commissionPaid || 0,
        availableCommission: partner.availableCommission || 0,
        totalClientsReferred: partner.totalClientsReferred || totalClientsReferred,
        totalOrdersReferred: partner.totalOrdersReferred || totalOrdersReferred,
        referralClicks: partner.referralClicks || 0,
        conversionRate: partner.conversionRate || conversionRate,
        totalReferralSales: partner.totalReferralSales || 0,
        createdAt: partner.createdAt,
        referredBy: partner.referredBy
      },
      clients: partner.clientsReferred || [],
      orders: partner.ordersReferred || []
    });

  } catch (error) {
    console.error('Partner detail error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch partner details',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Get partner statistics for admin dashboard
exports.getPartnerStats = async (req, res) => {
  try {
    const stats = await Partner.aggregate([
      {
        $group: {
          _id: null,
          totalPartners: { $sum: 1 },
          activePartners: { $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] } },
          totalCommission: { $sum: '$commissionEarned' },
          totalPaid: { $sum: '$commissionPaid' },
          totalClients: { $sum: '$totalClientsReferred' },
          totalClicks: { $sum: '$referralClicks' }
        }
      },
      {
        $project: {
          _id: 0,
          totalPartners: 1,
          activePartners: 1,
          inactivePartners: { $subtract: ['$totalPartners', '$activePartners'] },
          totalCommission: 1,
          totalPaid: 1,
          pendingPayout: { $subtract: ['$totalCommission', '$totalPaid'] },
          totalClients: 1,
          totalClicks: 1,
          avgClientsPerPartner: { $divide: ['$totalClients', '$totalPartners'] },
          conversionRate: { $multiply: [{ $divide: ['$totalClients', '$totalClicks'] }, 100] }
        }
      }
    ]);

    res.json({
      success: true,
      stats: stats[0] || {}
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to fetch partner stats'
    });
  }
};

// Update partner status (admin only)
exports.updatePartnerStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const partner = await Partner.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true }
    );

    if (!partner) {
      return res.status(404).json({
        success: false,
        error: 'Partner not found'
      });
    }

    await sendEmail({
      to: partner.email,
      subject: `Partner Account Status Update`,
      html: `Your partner account status has been updated to <strong>${status}</strong>.`
    });

    res.json({
      success: true,
      partner
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to update partner status'
    });
  }
};

// Admin-initiated payout
exports.adminProcessPayout = async (req, res) => {
  try {
    const { amount, notes } = req.body;
    const partner = await Partner.findById(req.params.id);

    if (!partner) {
      return res.status(404).json({
        success: false,
        error: 'Partner not found'
      });
    }

    const availableCommission = (partner.commissionEarned || 0) - (partner.commissionPaid || 0);
    
    if (amount > availableCommission) {
      return res.status(400).json({
        success: false,
        error: 'Payout amount exceeds available commission'
      });
    }

    // Update partner commission
    partner.commissionPaid += amount;
    await partner.save();

    // Create payout record (you'll need a Payout model)
    const payout = await Payout.create({
      partner: partner._id,
      amount,
      notes,
      processedBy: req.admin.id,
      status: 'completed'
    });

    await sendEmail({
      to: partner.email,
      subject: `Payout Processed by Admin`,
      html: `An admin has processed a payout of $${(amount / 100).toFixed(2)} for your account.`
    });

    res.json({
      success: true,
      payout,
      partner
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to process payout'
    });
  }
};