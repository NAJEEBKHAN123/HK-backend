const PartnerInvite = require('../model/PartnerInvite');
const Partner = require('../model/Partner');
const { sendEmail } = require('../services/partnerEmailService');
const crypto = require('crypto');

exports.generatePartnerCredential = async (req, res) => {
  try {
    const { email } = req.body;
    
    const token = crypto.randomBytes(32).toString('hex');
    const shortCode = `P-${Math.floor(1000 + Math.random() * 9000)}`;
    
    const invite = await PartnerInvite.create({
      email,
      token,
      shortCode,
      createdBy: req.admin.id
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

exports.approvePartner = async (req, res) => {
  try {
    const partner = await Partner.findByIdAndUpdate(
      req.params.id,
      { 
        status: 'active',
        joinedAt: new Date() 
      },
      { new: true }
    );

    await sendEmail({
      to: partner.email,
      subject: 'Partner Account Approved',
      html: `
        <h2>Welcome to Our Partner Program</h2>
        <p>Your referral code: <strong>${partner.referralCode}</strong></p>
        <p>Dashboard: ${process.env.FRONTEND_URL}/partner</p>
      `
    });

    res.json({ success: true, partner });

  } catch (error) {
    res.status(500).json({ 
      success: false,
      error: 'Approval failed',
      details: error.message
    });
  }
};

