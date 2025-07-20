const Partner = require('../model/Partner');
const PartnerInvite = require('../model/PartnerInvite');
const { sendAdminNotification } = require('../services/partnerEmailService');

exports.registerPartner = async (req, res) => {
  try {
    const { token, shortCode, email, name, password } = req.body;

    const existingPartner = await Partner.findOne({ email: req.body.email });
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

    // Create partner with 'active' status and generate referral code
    const referralCode = `REF-${require('crypto').randomBytes(3).toString('hex').toUpperCase()}`;
    const partner = await Partner.create({
      name,
      email,
      password,
      status: 'active', // Changed from default 'pending' to 'active'
      referralCode,
      referredBy: invite.createdBy,
      joinedAt: new Date() // Add registration timestamp
    });

    // Mark invite as used
    await PartnerInvite.findByIdAndUpdate(invite._id, {
      used: true,
      usedAt: new Date()
    });

    // Return success with referral info immediately
    res.status(201).json({
      success: true,
      message: 'Registration successful',
      partner: {
        id: partner._id,
        name: partner.name,
        email: partner.email,
        referralLink: `${process.env.FRONTEND_URL}/join?ref=${partner.referralCode}`,
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

exports.verifyInvite = async (req, res) => {
  try {
    const { token, shortCode } = req.body;
    
    // Add proper query for expiration check
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
      email: invite.email || '', // Always return email field even if null
      inviteData: { // Return additional invite data if needed
        createdBy: invite.createdBy,
        createdAt: invite.createdAt
      }
    });
  } catch (error) {
    console.error('Verification error:', error);
    res.status(500).json({
      valid: false,
      error: 'Verification failed',
      details: error.message
    });
  }
};