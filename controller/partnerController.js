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
        status: existingPartner.status // Shows if pending/active
      });
    }
    // Find valid invite
    const invite = await PartnerInvite.findOne({
      $or: [{ token }, { shortCode }],
      used: false,
      expiresAt: { $gt: new Date() }
    });

    if (!invite) {
      return res.status(400).json({
        success: false,
        error: 'Invalid or expired credentials',
        debug: {
          tokenExists: await PartnerInvite.exists({ token }),
          codeExists: await PartnerInvite.exists({ shortCode }),
          isExpired: (await PartnerInvite.findOne({ $or: [{ token }, { shortCode }] }))?.expiresAt < new Date()
        }
      });
    }

    // Create partner
    const partner = await Partner.create({
      name,
      email,
      password,
      referredBy: invite.createdBy
    });

    // Mark invite as used
    await PartnerInvite.findByIdAndUpdate(invite._id, {
      used: true,
      usedAt: new Date()
    });

    // Notify admin
    await sendAdminNotification('NEW_PARTNER_REGISTRATION', {
      partnerId: partner._id,
      partnerName: partner.name
    });

    res.status(201).json({
      success: true,
      message: 'Registration successful. Awaiting admin approval.',
      partnerId: partner._id
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
      email: invite.email // Returns pre-filled email if exists
    });
  } catch (error) {
    res.status(500).json({
      valid: false,
      error: 'Verification failed'
    });
  }
};