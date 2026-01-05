const Partner = require('../model/Partner');
const PartnerInvite = require('../model/PartnerInvite');
const Client = require('../model/Client');
const { sendEmail } = require('../services/partnerEmailService');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

// ========== CLICK TRACKING FUNCTIONS ==========

// Main click tracking endpoint
exports.trackClick = async (req, res) => {
  try {
    const { code } = req.params;
    
    console.log('🔗 CLICK TRACKING STARTED:', {
      code: code,
      timestamp: new Date().toISOString(),
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      referrer: req.get('Referer')
    });
    
    // Find active partner
    const partner = await Partner.findOne({ 
      referralCode: code,
      status: 'active'
    });

    if (!partner) {
      console.log('❌ Partner not found or inactive:', code);
      // ✅ FIXED: Use production URL when in production
      const frontendUrl = process.env.NODE_ENV === 'production' 
        ? process.env.FRONTEND_URL_PROD || 'https://ouvrir-societe-hong-kong.fr'
        : process.env.FRONTEND_URL || 'http://localhost:5173';
      return res.redirect(`${frontendUrl}/signup`);
    }

    console.log('✅ Partner found:', {
      name: partner.name,
      email: partner.email,
      currentClicks: partner.referralClicks
    });
    
    // ========== UPDATE CLICKS ==========
    partner.referralClicks = (partner.referralClicks || 0) + 1;
    partner.lastClickAt = new Date();
    partner.lastClickIP = req.ip;
    
    // Add to click history if field exists
    if (partner.clickHistory && Array.isArray(partner.clickHistory)) {
      partner.clickHistory.push({
        timestamp: new Date(),
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        referrer: req.get('Referer')
      });
      
      // Keep only last 100 clicks
      if (partner.clickHistory.length > 100) {
        partner.clickHistory = partner.clickHistory.slice(-100);
      }
    }
    
    await partner.save();
    
    console.log('✅ Click tracked successfully:', {
      partner: partner.email,
      newClicks: partner.referralClicks,
      updatedAt: partner.updatedAt
    });
    
    // ========== SET COOKIES ==========
    res.cookie('partner_ref', code, {
      maxAge: 30 * 24 * 60 * 60 * 1000,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax'
    });
    
    res.cookie('ref_session', code, {
      maxAge: 2 * 60 * 60 * 1000,
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax'
    });
    
    // ========== REDIRECT TO SIGNUP ==========
    // ✅ FIXED: Use production URL when in production
    const frontendUrl = process.env.NODE_ENV === 'production' 
      ? process.env.FRONTEND_URL_PROD || 'https://ouvrir-societe-hong-kong.fr'
      : process.env.FRONTEND_URL || 'http://localhost:5173';
    
    const redirectUrl = `${frontendUrl}/signup?ref=${code}`;
    
    console.log('🔄 Redirecting to:', redirectUrl);
    
    res.redirect(302, redirectUrl);
    
  } catch (error) {
    console.error('❌ Click tracking error:', {
      error: error.message,
      stack: error.stack,
      code: req.params?.code
    });
    
    // ✅ FIXED: Use production URL when in production
    const frontendUrl = process.env.NODE_ENV === 'production' 
      ? process.env.FRONTEND_URL_PROD || 'https://ouvrir-societe-hong-kong.fr'
      : process.env.FRONTEND_URL || 'http://localhost:5173';
    res.redirect(`${frontendUrl}/signup`);
  }
};

// Test click endpoint (for admin testing)
exports.testClickTracking = async (req, res) => {
  try {
    const { code } = req.params;
    
    console.log(`🧪 Test click for code: ${code}`);
    
    const partner = await Partner.findOne({ referralCode: code });
    
    if (!partner) {
      return res.status(404).json({
        success: false,
        error: 'Partner not found',
        code
      });
    }
    
    partner.referralClicks = (partner.referralClicks || 0) + 1;
    partner.lastClickAt = new Date();
    partner.lastClickIP = '127.0.0.1';
    
    await partner.save();
    
    res.json({
      success: true,
      message: `Test click counted for ${partner.email}`,
      totalClicks: partner.referralClicks,
      partner: {
        name: partner.name,
        email: partner.email,
        referralCode: partner.referralCode,
        status: partner.status
      }
    });
  } catch (error) {
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
};

// Manual click update (admin)
exports.manualUpdateClicks = async (req, res) => {
  try {
    const { id } = req.params;
    const { clicks } = req.body;
    
    console.log('🔄 Manual click update:', { partnerId: id, newClicks: clicks });
    
    const partner = await Partner.findById(id);
    
    if (!partner) {
      return res.status(404).json({
        success: false,
        error: 'Partner not found'
      });
    }
    
    const oldClicks = partner.referralClicks || 0;
    partner.referralClicks = parseInt(clicks);
    await partner.save();
    
    console.log('✅ Manual click update successful:', {
      partner: partner.email,
      oldClicks: oldClicks,
      newClicks: partner.referralClicks
    });
    
    res.json({
      success: true,
      message: 'Click count updated manually',
      data: {
        partnerId: partner._id,
        name: partner.name,
        email: partner.email,
        oldClicks: oldClicks,
        newClicks: partner.referralClicks
      }
    });
    
  } catch (error) {
    console.error('❌ Manual click update error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

// Get click stats
exports.getClickStats = async (req, res) => {
  try {
    const { id } = req.params;
    
    const partner = await Partner.findById(id).select('referralClicks clickHistory lastClickAt');
    
    if (!partner) {
      return res.status(404).json({
        success: false,
        error: 'Partner not found'
      });
    }
    
    // Analyze click history
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const last7Days = new Date();
    last7Days.setDate(last7Days.getDate() - 7);
    
    const clicksToday = partner.clickHistory?.filter(click => 
      new Date(click.timestamp) >= today
    ).length || 0;
    
    const clicksLast7Days = partner.clickHistory?.filter(click => 
      new Date(click.timestamp) >= last7Days
    ).length || 0;
    
    res.json({
      success: true,
      data: {
        totalClicks: partner.referralClicks || 0,
        clicksToday: clicksToday,
        clicksLast7Days: clicksLast7Days,
        lastClickAt: partner.lastClickAt,
        clickHistoryCount: partner.clickHistory?.length || 0,
        recentClicks: partner.clickHistory?.slice(-10).reverse() || []
      }
    });
    
  } catch (error) {
    console.error('❌ Get click stats error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

// Debug endpoint
exports.debugPartnerClicks = async (req, res) => {
  try {
    const { code } = req.params;
    
    const partner = await Partner.findOne({ referralCode: code });
    
    if (!partner) {
      return res.status(404).json({
        success: false,
        error: 'Partner not found',
        code
      });
    }
    
    res.json({
      success: true,
      partner: {
        name: partner.name,
        email: partner.email,
        referralCode: partner.referralCode,
        referralClicks: partner.referralClicks || 0,
        referralLink: partner.referralLink,
        lastClickAt: partner.lastClickAt,
        status: partner.status,
        createdAt: partner.createdAt
      },
      modelFields: Object.keys(partner._doc)
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

// ========== LOGIN FUNCTION ==========
exports.loginPartner = async (req, res) => {
  try {
    const { email, password } = req.body;

    console.log('🔐 Login attempt for:', email);

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Please provide email and password'
      });
    }

    const partner = await Partner.findOne({ email }).select('+password');
    if (!partner) {
      console.log('❌ Partner not found:', email);
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials'
      });
    }

    console.log('✅ Partner found:', {
      id: partner._id,
      name: partner.name,
      status: partner.status
    });

    const isMatch = await partner.comparePassword(password);
    if (!isMatch) {
      console.log('❌ Password mismatch for:', email);
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials'
      });
    }

    // Check if partner is active
    if (partner.status !== 'active') {
      console.log('❌ Partner not active:', partner.status);
      return res.status(401).json({
        success: false,
        error: 'Account is not active. Please contact support.'
      });
    }

    // ========== CREATE TOKEN ==========
    const token = jwt.sign(
      { 
        id: partner._id, 
        role: 'partner',
        email: partner.email
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRE || '30d' }
    );

    console.log('✅ Token created for partner:', {
      partnerId: partner._id,
      email: partner.email,
      role: 'partner',
      tokenLength: token.length
    });

    const cookieOptions = {
      expires: new Date(
        Date.now() + (process.env.JWT_COOKIE_EXPIRE || 30) * 24 * 60 * 60 * 1000
      ),
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict'
    };

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
          referralCode: partner.referralCode,
          referralClicks: partner.referralClicks || 0,
          status: partner.status
        }
      });

  } catch (error) {
    console.error('❌ Login error:', error);
    res.status(500).json({
      success: false,
      error: 'Login failed',
      details: error.message
    });
  }
};

// ========== DASHBOARD FUNCTIONS ==========

// Get partner dashboard data - UPDATED
// Get partner dashboard data - UPDATED
exports.getPartnerDashboard = async (req, res) => {
  try {
    console.log('📊 Fetching dashboard for partner:', req.partner?._id);
    
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
        options: { sort: { createdAt: -1 }, limit: 10 }
      })
      .populate({
        path: 'ordersReferred',
        select: 'plan finalPrice createdAt status',
        options: { sort: { createdAt: -1 }, limit: 10 }
      });

    if (!partner) {
      return res.status(404).json({
        success: false,
        error: 'Partner not found'
      });
    }

    // Calculate conversion rate
    const conversionRate = partner.referralClicks > 0 
      ? (((partner.clientsReferred?.length || 0) / partner.referralClicks) * 100).toFixed(2)
      : '0.00';

    // ✅ FIXED: Use production backend URL when in production
    const backendUrl = process.env.NODE_ENV === 'production'
      ? 'https://hk-backend-tau.vercel.app'  // Production backend
      : process.env.BACKEND_URL || 'http://localhost:3000';
    
    // ✅ FIXED: Use production frontend URL when in production
    const frontendUrl = process.env.NODE_ENV === 'production'
      ? process.env.FRONTEND_URL_PROD || 'https://ouvrir-societe-hong-kong.fr'
      : process.env.FRONTEND_URL || 'http://localhost:5173';
    
    const referralLink = `${backendUrl}/api/partner-auth/track-click/${partner.referralCode}`;
    const directLink = `${frontendUrl}/signup?ref=${partner.referralCode}`;

    res.json({
      success: true,
      data: {
        partner: {
          id: partner._id,
          name: partner.name,
          email: partner.email,
          referralCode: partner.referralCode,
          referralLink: referralLink,
          directSignupLink: directLink,
          status: partner.status,
          commissionEarned: partner.commissionEarned || 0,
          commissionPaid: partner.commissionPaid || 0,
          availableCommission: (partner.commissionEarned || 0) - (partner.commissionPaid || 0),
          totalClientsReferred: partner.clientsReferred?.length || 0,
          totalOrdersReferred: partner.ordersReferred?.length || 0,
          referralClicks: partner.referralClicks || 0,
          conversionRate: conversionRate,
          totalReferralSales: partner.totalReferralSales || 0,
          commissionRate: partner.commissionRate || 10,
          lastClickAt: partner.lastClickAt
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

// Verify partner (for protected route)
exports.verifyPartners = async (req, res) => {
  try {
    console.log('🔍 Verifying partner access:', {
      partnerId: req.partner?._id,
      partnerEmail: req.partner?.email,
      userRole: req.user?.role
    });

    if (!req.partner) {
      console.log('❌ No partner in request');
      return res.status(401).json({
        success: false,
        error: 'Not authenticated as partner'
      });
    }

    const partner = await Partner.findById(req.partner.id)
      .select('-password')
      .lean();

    if (!partner) {
      console.log('❌ Partner not found in database:', req.partner.id);
      return res.status(404).json({
        success: false,
        error: 'Partner not found'
      });
    }

    console.log('✅ Partner verified:', partner.email);

    res.status(200).json({
      success: true,
      partner: {
        id: partner._id,
        name: partner.name,
        email: partner.email,
        referralCode: partner.referralCode,
        status: partner.status
      }
    });
  } catch (error) {
    console.error('Verification failed:', error);
    res.status(500).json({
      success: false,
      error: 'Verification failed',
      details: error.message
    });
  }
};

// Get current partner
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
        referralCode: partner.referralCode,
        referralClicks: partner.referralClicks || 0,
        lastClickAt: partner.lastClickAt
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

// ========== OTHER FUNCTIONS ==========

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
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
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

// Register new partner - UPDATED WITH TRACKING LINK
// Register new partner - UPDATED WITH TRACKING LINK
exports.registerPartner = async (req, res) => {
  try {
    const { token, shortCode, email, name, password } = req.body;

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
    
    // ✅ FIXED: Use production backend URL when in production
    const backendUrl = process.env.NODE_ENV === 'production'
      ? 'https://hk-backend-tau.vercel.app'  // Production backend
      : process.env.BACKEND_URL || 'http://localhost:3000';
    
    // ✅ FIXED: Use production frontend URL when in production
    const frontendUrl = process.env.NODE_ENV === 'production'
      ? process.env.FRONTEND_URL_PROD || 'https://ouvrir-societe-hong-kong.fr'
      : process.env.FRONTEND_URL || 'http://localhost:5173';
    
    const trackingLink = `${backendUrl}/api/partner-auth/track-click/${referralCode}`;
    
    const partner = await Partner.create({
      name,
      email,
      password,
      status: 'active',
      referralCode,
      referralLink: trackingLink,
      referredBy: invite.createdBy,
      joinedAt: new Date()
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
        <p>Your tracking link: <a href="${partner.referralLink}">${partner.referralLink}</a></p>
        <p>This link will track clicks and redirect users to signup.</p>
        <p>Start sharing your link to track clicks and earn commissions!</p>
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
        dashboardLink: `${frontendUrl}/partner/dashboard`
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

// Verify referral code - KEPT FOR BACKWARD COMPATIBILITY
// Verify referral code - KEPT FOR BACKWARD COMPATIBILITY
exports.verifyReferral = async (req, res) => {
  try {
    const { code, redirect } = req.query;
    
    console.log(`🔗 Legacy click tracking for code: ${code}`);
    
    const partner = await Partner.findOne({ 
      referralCode: code,
      status: 'active'
    });

    if (!partner) {
      console.log(`❌ Partner not found or inactive: ${code}`);
      
      // ✅ FIXED: Use production URL when in production
      const frontendUrl = process.env.NODE_ENV === 'production' 
        ? process.env.FRONTEND_URL_PROD || 'https://ouvrir-societe-hong-kong.fr'
        : process.env.FRONTEND_URL || 'http://localhost:5173';
        
      return res.redirect(`${frontendUrl}/partner-signup`);
    }

    partner.referralClicks = (partner.referralClicks || 0) + 1;
    partner.lastClickAt = new Date();
    partner.lastClickIP = req.ip;
    await partner.save();

    console.log(`✅ Legacy click tracked: ${partner.email}, Total clicks: ${partner.referralClicks}`);
    
    res.cookie('referralCode', code, {
      maxAge: 30 * 24 * 60 * 60 * 1000,
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production'
    });
    
    // ✅ FIXED: Use production URL when in production
    const frontendUrl = process.env.NODE_ENV === 'production' 
      ? process.env.FRONTEND_URL_PROD || 'https://ouvrir-societe-hong-kong.fr'
      : process.env.FRONTEND_URL || 'http://localhost:5173';
      
    const targetUrl = redirect 
      ? `${redirect}?ref=${code}` 
      : `${frontendUrl}/partner-signup?ref=${code}`;
    
    console.log(`🔄 Redirecting to: ${targetUrl}`);
    res.redirect(targetUrl);
    
  } catch (error) {
    console.error('❌ Referral verification error:', error);
    
    // ✅ FIXED: Use production URL when in production
    const frontendUrl = process.env.NODE_ENV === 'production' 
      ? process.env.FRONTEND_URL_PROD || 'https://ouvrir-societe-hong-kong.fr'
      : process.env.FRONTEND_URL || 'http://localhost:5173';
      
    res.redirect(`${frontendUrl}/partner-signup`);
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

    const availableCommission = (partner.commissionEarned || 0) - (partner.commissionPaid || 0);
    if (availableCommission <= 0) {
      return res.status(400).json({
        success: false,
        error: 'No available commission for payout'
      });
    }

    partner.commissionPaid = partner.commissionEarned || 0;
    await partner.save();

    await sendEmail({
      to: partner.email,
      subject: 'Payout Request Received',
      html: `
        <h2>Payout Request Processed</h2>
        <p>We've received your payout request for €${(availableCommission / 100).toFixed(2)}.</p>
        <p>The amount should appear in your account within 3-5 business days.</p>
      `
    });

    res.json({
      success: true,
      message: `Payout of €${(availableCommission / 100).toFixed(2)} initiated`,
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

// ========== ADMIN FUNCTIONS ==========

// Get all partners for admin
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
      .select('name email referralCode status createdAt commissionEarned commissionPaid referralClicks lastClickAt')
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

// Get detailed partner info for admin - UPDATED
// Get detailed partner info for admin - UPDATED
exports.getAdminPartnerDetails = async (req, res) => {
  try {
    if (!req.admin?.id) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized - Admin access required'
      });
    }

    const partner = await Partner.findById(req.params.id)
      .populate('clientsReferred', 'name email createdAt source orders')
      .populate({
        path: 'ordersReferred',
        select: 'plan finalPrice originalPrice createdAt status customerDetails.email partnerCommission',
        options: { sort: { createdAt: -1 } }
      });

    if (!partner) {
      return res.status(404).json({
        success: false,
        error: 'Partner not found'
      });
    }

    const conversionRate = partner.referralClicks > 0 
      ? parseFloat(((partner.clientsReferred?.length || 0) / partner.referralClicks) * 100).toFixed(2)
      : 0;

    // ✅ FIXED: Use production backend URL when in production
    const backendUrl = process.env.NODE_ENV === 'production'
      ? 'https://hk-backend-tau.vercel.app'  // Production backend
      : process.env.BACKEND_URL || 'http://localhost:3000'; // Development
    
    // ✅ FIXED: Use production frontend URL when in production  
    const frontendUrl = process.env.NODE_ENV === 'production'
      ? process.env.FRONTEND_URL_PROD || 'https://ouvrir-societe-hong-kong.fr'
      : process.env.FRONTEND_URL || 'http://localhost:5173';
    
    const referralLink = `${backendUrl}/api/partner-auth/track-click/${partner.referralCode}`;
    const directLink = `${frontendUrl}/signup?ref=${partner.referralCode}`;

    res.json({
      success: true,
      data: {
        partner: {
          id: partner._id,
          name: partner.name,
          email: partner.email,
          referralCode: partner.referralCode,
          referralLink: referralLink, // Tracking link
          directSignupLink: directLink, // Direct signup link
          status: partner.status,
          commissionEarned: partner.commissionEarned || 0,
          commissionPaid: partner.commissionPaid || 0,
          availableCommission: (partner.commissionEarned || 0) - (partner.commissionPaid || 0),
          totalClientsReferred: partner.clientsReferred?.length || 0,
          totalOrdersReferred: partner.ordersReferred?.length || 0,
          referralClicks: partner.referralClicks || 0,
          conversionRate: conversionRate,
          totalReferralSales: partner.totalReferralSales || 0,
          commissionRate: partner.commissionRate || 10,
          lastClickAt: partner.lastClickAt,
          lastClickIP: partner.lastClickIP,
          createdAt: partner.createdAt,
          referredBy: partner.referredBy
        },
        clients: partner.clientsReferred || [],
        orders: partner.ordersReferred || [],
        clickStats: {
          totalClicks: partner.referralClicks || 0,
          lastClickAt: partner.lastClickAt,
          clickHistoryCount: partner.clickHistory?.length || 0,
          todayClicks: partner.clickHistory?.filter(click => {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            return new Date(click.timestamp) >= today;
          }).length || 0
        }
      }
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

// Get partner statistics
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
          totalClients: { $sum: { $size: '$clientsReferred' } },
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
          conversionRate: { 
            $cond: [
              { $eq: ['$totalClicks', 0] },
              0,
              { $multiply: [{ $divide: ['$totalClients', '$totalClicks'] }, 100] }
            ]
          }
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

// Update partner status
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

// Admin process payout
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

    const amountInCents = Math.round(amount * 100);
    const availableCommissionInCents = (partner.commissionEarned || 0) - (partner.commissionPaid || 0);
    
    if (amountInCents > availableCommissionInCents) {
      return res.status(400).json({
        success: false,
        error: 'Payout amount exceeds available commission'
      });
    }

    partner.commissionPaid += amountInCents;
    await partner.save();

    await sendEmail({
      to: partner.email,
      subject: `Payout Processed by Admin`,
      html: `An admin has processed a payout of €${amount.toFixed(2)} for your account.`
    });

    res.json({
      success: true,
      message: `Payout of €${amount.toFixed(2)} processed successfully`,
      partner: {
        ...partner.toObject(),
        commissionEarned: partner.commissionEarned,
        commissionPaid: partner.commissionPaid,
        availableCommission: partner.commissionEarned - partner.commissionPaid
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to process payout'
    });
  }
};

// Approve partner
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
        <p>Your tracking link: <a href="${partner.referralLink}">${partner.referralLink}</a></p>
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