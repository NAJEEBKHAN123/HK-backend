const Partner = require('../model/Partner');
const PartnerInvite = require('../model/PartnerInvite');
const Client = require('../model/Client');
const { sendEmail } = require('../services/partnerEmailService');
const crypto = require('crypto');

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
    const partner = await Partner.findById(req.partner.id)
      .populate('clientsReferred', 'name email createdAt')
      .populate('ordersReferred', 'plan finalPrice createdAt');

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
          conversionRate: partner.conversionRate
        },
        clients: partner.clientsReferred,
        orders: partner.ordersReferred
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to fetch partner data',
      details: error.message
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