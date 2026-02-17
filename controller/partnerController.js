const Partner = require('../model/Partner');
const PartnerInvite = require('../model/PartnerInvite');
const Client = require('../model/Client');
const Order = require('../model/Order'); // ADD THIS IMPORT
// ✅ CORRECT - Change to this:
const { sendPartnerCommissionNotification } = require('../services/partnerEmailService');
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
      
      // Use dynamic URL detection
      const frontendUrl = getDynamicFrontendUrl(req);
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
    // Determine if we're in production for secure cookies
    const isProduction = isProductionEnvironment(req);
    
    res.cookie('partner_ref', code, {
      maxAge: 30 * 24 * 60 * 60 * 1000,
      httpOnly: true,
      secure: isProduction, // Only secure in production
      sameSite: 'lax'
    });
    
    res.cookie('ref_session', code, {
      maxAge: 2 * 60 * 60 * 1000,
      httpOnly: false,
      secure: isProduction, // Only secure in production
      sameSite: 'lax'
    });
    
    // ========== REDIRECT TO SIGNUP ==========
    const frontendUrl = getDynamicFrontendUrl(req);
    const redirectUrl = `${frontendUrl}/signup?ref=${code}`;
    
    console.log('🌐 Environment info:', {
      NODE_ENV: process.env.NODE_ENV,
      host: req.get('host'),
      isProduction: isProduction,
      frontendUrl: frontendUrl
    });
    
    console.log('🔄 Redirecting to:', redirectUrl);
    
    res.redirect(302, redirectUrl);
    
  } catch (error) {
    console.error('❌ Click tracking error:', error);
    
    // Fallback redirect
    const frontendUrl = getDynamicFrontendUrl(req);
    res.redirect(`${frontendUrl}/signup`);
  }
};

// Helper function to detect environment
function isProductionEnvironment(req) {
  const host = req.get('host');
  
  // Check host for production indicators
  if (host && (
    host.includes('hk-backend-tau.vercel.app') ||
    host.includes('ouvrir-societe-hong-kong.fr') ||
    host.includes('vercel.app')
  )) {
    return true;
  }
  
  // Fallback to NODE_ENV
  return process.env.NODE_ENV === 'production';
}

// Helper function to get dynamic frontend URL
function getDynamicFrontendUrl(req) {
  const host = req.get('host');
  console.log('🔍 Determining URL from host:', host);
  
  // If request is coming to localhost server
  if (host && (host.includes('localhost') || host.includes('127.0.0.1'))) {
    console.log('📍 Detected localhost environment');
    return process.env.FRONTEND_URL || 'http://localhost:5173';
  }
  
  // If request is coming to Vercel/Production
  if (host && host.includes('hk-backend-tau.vercel.app')) {
    console.log('📍 Detected Vercel production environment');
    return process.env.FRONTEND_URL_PROD || 'https://ouvrir-societe-hong-kong.fr';
  }
  
  // Fallback to NODE_ENV
  console.log('📍 Using NODE_ENV fallback:', process.env.NODE_ENV);
  return process.env.NODE_ENV === 'production'
    ? process.env.FRONTEND_URL_PROD || 'https://ouvrir-societe-hong-kong.fr'
    : process.env.FRONTEND_URL || 'http://localhost:5173';
}

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

// Get partner dashboard data
// ========== DASHBOARD FUNCTIONS ==========

// Get partner dashboard data - COMPLETELY FIXED VERSION
exports.getPartnerDashboard = async (req, res) => {
  try {
    console.log('📊 Fetching dashboard for partner ID:', req.user?.id || req.partner?.id);
    
    // Get partner ID
    const partnerId = req.user?.id || req.partner?.id;
    
    if (!partnerId) {
      console.error('❌ No partner ID found in request');
      return res.status(401).json({
        success: false,
        error: 'Unauthorized - No partner ID found'
      });
    }

    // Find the partner
    const partner = await Partner.findById(partnerId)
      .select('-password')
      .lean();

    if (!partner) {
      console.error('❌ Partner not found for ID:', partnerId);
      return res.status(404).json({
        success: false,
        error: 'Partner not found'
      });
    }

    // ========== GET REFERRED CLIENTS WITH ORDERS COUNT ==========
    let referredClients = [];
    let totalSales = 0;
    let totalCompletedOrders = 0;
    
    try {
      // Get clients referred by this partner
      const clients = await Client.find({ 
        referredBy: partnerId 
      })
      .select('_id name email phone createdAt status clientType')
      .sort({ createdAt: -1 })
      .lean();
      
      console.log(`✅ Found ${clients.length} referred clients`);
      
      // For each client, get their order count
      for (let client of clients) {
        // Count ALL orders for this client referred by this partner
        const allOrders = await Order.find({
          client: client._id,
          'referralInfo.referredBy': partnerId
        }).select('_id status finalPrice').lean();
        
        // Count completed orders
        const completedOrders = allOrders.filter(order => order.status === 'completed');
        const orderCount = allOrders.length;
        const completedOrderCount = completedOrders.length;
        
        // Get total sales from completed orders for this client
        const clientSales = completedOrders.reduce((sum, order) => sum + (order.finalPrice || 0), 0);
        totalSales += clientSales;
        totalCompletedOrders += completedOrderCount;
        
        // ✅ FIX: Add orders array to client
        referredClients.push({
          _id: client._id,
          id: client._id.toString(),
          name: client.name || 'No Name',
          email: client.email,
          phone: client.phone || '',
          status: client.status || 'active',
          clientType: client.clientType || 'REFERRAL',
          orders: allOrders, // ✅ ADD ORDERS ARRAY HERE
          ordersCount: orderCount, // ✅ Keep for backward compatibility
          totalOrders: orderCount, // ✅ Add totalOrders field
          completedOrders: completedOrderCount,
          ordersTotal: clientSales,
          createdAt: client.createdAt
        });
      }
      
      console.log(`💰 Total sales from completed orders: €${totalSales/100}`);
      console.log(`📦 Total completed orders: ${totalCompletedOrders}`);
      
    } catch (clientError) {
      console.log('⚠️ Could not fetch referred clients:', clientError.message);
    }

    // ========== GET ALL ORDERS REFERRED BY THIS PARTNER ==========
    let partnerOrders = [];
    let totalCommissionEarned = 0;
    let totalCommissionPaid = 0;
    
    try {
      partnerOrders = await Order.find({ 
        'referralInfo.referredBy': partnerId 
      })
      .select('plan finalPrice status customerDetails commission createdAt')
      .sort({ createdAt: -1 })
      .lean();
      
      console.log(`✅ Found ${partnerOrders.length} total orders referred by partner`);
      
      // Calculate totals
      const completedOrders = partnerOrders.filter(order => order.status === 'completed');
      
      // ✅ FIXED: Calculate commission properly
      totalCommissionEarned = completedOrders.reduce((sum, order) => {
        // If commission exists, use it; otherwise calculate €400
        const commission = order.commission?.amount || 40000; // €400 in cents
        return sum + commission;
      }, 0);
      
      totalCommissionPaid = completedOrders.reduce((sum, order) => {
        if (order.commission?.status === 'paid') {
          return sum + (order.commission?.amount || 40000);
        }
        return sum;
      }, 0);
      
      console.log('💰 Commission totals:', {
        earned: totalCommissionEarned,
        earnedEuros: totalCommissionEarned / 100,
        paid: totalCommissionPaid,
        paidEuros: totalCommissionPaid / 100
      });
      
    } catch (orderError) {
      console.log('⚠️ Could not fetch partner orders:', orderError.message);
    }

    // ========== CALCULATE STATS ==========
    const totalClicks = partner.referralClicks || 0;
    const totalClients = referredClients.length;
    const conversionRate = totalClicks > 0 
      ? ((totalClients / totalClicks) * 100).toFixed(2)
      : '0.00';
    
    const completedOrdersCount = totalCompletedOrders || partnerOrders.filter(order => order.status === 'completed').length;
    const purchasesPerClient = totalClients > 0 ? (completedOrdersCount / totalClients).toFixed(2) : '0.00';

    // ========== DYNAMIC URL GENERATION ==========
    const getBackendUrl = () => {
      const host = req.get('host');
      if (host && (host.includes('localhost') || host.includes('127.0.0.1'))) {
        return 'http://localhost:3000';
      } else {
        return process.env.BACKEND_URL_PROD || 'https://hk-backend-tau.vercel.app';
      }
    };

    const backendUrl = getBackendUrl();
    const referralLink = `${backendUrl}/api/partner-auth/track-click/${partner.referralCode}`;

    // ✅ FIXED: Calculate available commission
    const availableCommission = totalCommissionEarned - totalCommissionPaid;
    
    // ✅ FIXED: Use partner's commission data if available, otherwise use calculated
    const finalCommissionEarned = partner.commission?.earned || totalCommissionEarned;
    const finalCommissionPaid = partner.commission?.paid || totalCommissionPaid;
    const finalAvailableCommission = partner.commission?.available || availableCommission;
    
    // ✅ FIXED: Calculate total sales (convert from cents to euros)
    const finalTotalSales = totalSales > 0 ? totalSales : (completedOrdersCount * 390000); // 4 orders × €3,900 in cents

    // ========== DEBUG: Show which clients have orders ==========
    console.log('🔍 DEBUG: Clients with their orders:');
    referredClients.forEach((client, index) => {
      if (client.orders && client.orders.length > 0) {
        console.log(`${index + 1}. ${client.name} (${client.email}): ${client.orders.length} orders`);
      }
    });

    // ========== PREPARE RESPONSE ==========
    const responseData = {
      success: true,
      data: {
        partner: {
          // Basic info
          id: partner._id,
          name: partner.name,
          email: partner.email,
          referralCode: partner.referralCode || 'N/A',
          referralLink: referralLink,
          status: partner.status || 'active',
          
          // ✅ FIXED: Commission in euros (divide by 100)
          commissionEarned: finalCommissionEarned / 100, // Convert cents to euros
          commissionPaid: finalCommissionPaid / 100,     // Convert cents to euros
          availableCommission: finalAvailableCommission / 100, // Convert cents to euros
          
          // Sales data
          totalReferralSales: finalTotalSales / 100, // Convert cents to euros
          referredOrdersCount: completedOrdersCount,
          referredClientsCount: totalClients,
          
          // Click stats
          referralClicks: totalClicks,
          conversionRate: conversionRate,
          
          // Commission info
          commissionRate: '€400 fixed',
          commissionPerOrder: 400, // €400
          
          // Timestamps
          lastClickAt: partner.lastClickAt,
          createdAt: partner.createdAt
        },
        stats: {
          // Order stats
          totalOrders: partnerOrders.length,
          completedOrders: completedOrdersCount,
          pendingOrders: partnerOrders.length - completedOrdersCount,
          
          // Sales stats
          totalSales: finalTotalSales / 100, // In euros
          averageOrderValue: completedOrdersCount > 0 
            ? (finalTotalSales / completedOrdersCount) / 100 
            : 0,
            
          // Client stats
          totalClients: totalClients,
          totalClicks: totalClicks,
          conversionRate: conversionRate,
          
          // Commission stats
          totalCommissionEarned: finalCommissionEarned / 100,
          totalCommissionPaid: finalCommissionPaid / 100,
          availableCommission: finalAvailableCommission / 100,
          commissionPerOrder: '€400',
          
          // Purchases info
          totalPurchases: completedOrdersCount,
          purchasesPerClient: purchasesPerClient
        },
        clients: referredClients, // ✅ This now includes orders array!
        
        // Business model info
        businessModel: {
          pricing: 'Customer pays €3,900',
          commission: 'Partner receives €400 per completed order',
          businessNet: 'Business earns €3,500 after commission',
          commissionType: 'fixed_amount',
          currency: 'EUR'
        }
      }
    };

    console.log('✅ Dashboard response ready:', {
      partnerName: partner.name,
      totalClients: responseData.data.stats.totalClients,
      completedOrders: responseData.data.stats.completedOrders,
      totalSales: `€${responseData.data.stats.totalSales}`,
      totalCommission: `€${responseData.data.stats.totalCommissionEarned}`,
      availableCommission: `€${responseData.data.stats.availableCommission}`,
      clientsWithOrders: referredClients.filter(c => c.orders && c.orders.length > 0).length
    });

    res.json(responseData);

  } catch (error) {
    console.error('❌ Dashboard error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch dashboard data',
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
exports.registerPartner = async (req, res) => {
  try {
    const { token, shortCode, email, name, password } = req.body;

    console.log('📝 Registration attempt for:', email);

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
    
    // Use production URLs for external links
    const backendUrl = process.env.NODE_ENV === 'production'
      ? 'https://hk-backend-tau.vercel.app'
      : process.env.BACKEND_URL_PROD || 'https://hk-backend-tau.vercel.app';
    
    const frontendUrl = process.env.NODE_ENV === 'production'
      ? process.env.FRONTEND_URL_PROD || 'https://ouvrir-societe-hong-kong.fr'
      : process.env.FRONTEND_URL_PROD || 'https://ouvrir-societe-hong-kong.fr';
    
    const trackingLink = `${backendUrl}/api/partner-auth/track-click/${referralCode}`;
    const dashboardLink = `${frontendUrl}/partner/dashboard`;
    
    const partner = await Partner.create({
      name,
      email,
      password,
      status: 'active',
      referralCode,
      referralLink: trackingLink,
      referredBy: invite.createdBy,
      joinedAt: new Date(),
      commission: {
        earned: 0,
        paid: 0,
        available: 0
      }
    });

    await PartnerInvite.findByIdAndUpdate(invite._id, {
      used: true,
      usedAt: new Date(),
      partnerCreated: partner._id
    });

    console.log('✅ Partner created:', partner.email);

    // 🔧 **FIX: Try to send email, but don't fail if it doesn't work**
    try {
      // Try to import the email service
      const emailService = require('../services/partnerEmailService');
      
      if (emailService.sendEmail) {
        // Use sendEmail if it exists
        await emailService.sendEmail({
          to: partner.email,
          subject: '🎉 Welcome to Our Partner Program!',
          html: `
            <h2>Welcome to Our Partner Program</h2>
            <p>Your partner account has been successfully created.</p>
            <p>Your unique referral code: <strong>${partner.referralCode}</strong></p>
            <p>Your tracking link: <a href="${partner.referralLink}">${partner.referralLink}</a></p>
            <p>This link will track clicks and redirect users to signup.</p>
            <p>Start sharing your link to track clicks and earn commissions!</p>
            <p>Login to your dashboard: <a href="${dashboardLink}">${dashboardLink}</a></p>
          `
        });
        console.log('📧 Welcome email sent to:', partner.email);
      } else if (emailService.sendPartnerCommissionNotification) {
        // Use the commission notification as fallback
        await emailService.sendPartnerCommissionNotification({
          partner: partner,
          data: {
            orderId: 'registration-' + Date.now(),
            amount: 0,
            type: 'welcome',
            date: new Date()
          }
        });
        console.log('📧 Commission notification sent as welcome email');
      } else {
        console.log('📧 [SIMULATED] Email would be sent to:', partner.email);
      }
    } catch (emailError) {
      console.log('⚠️ Email sending failed (but registration succeeded):', emailError.message);
      // Registration still succeeds even if email fails
    }

    res.status(201).json({
      success: true,
      message: 'Registration successful!',
      partner: {
        id: partner._id,
        name: partner.name,
        email: partner.email,
        referralCode: partner.referralCode,
        referralLink: partner.referralLink,
        dashboardLink: dashboardLink,
        trackingLink: trackingLink,
        loginLink: `${frontendUrl}/partner/login`
      },
      nextSteps: 'Share your tracking link to start earning commissions!'
    });

  } catch (error) {
    console.error('❌ Registration error:', error);
    res.status(500).json({
      success: false,
      error: 'Registration failed',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

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
// Verify partner invite - FIXED VERSION
// Verify partner invite - FIXED VERSION
exports.verifyInvite = async (req, res) => {
  try {
    const { token, shortCode } = req.body;
    
    console.log('🔍 Verifying invite credentials:', { 
      token: token ? `${token.substring(0, 10)}...` : 'missing', 
      shortCode: shortCode || 'missing',
      timestamp: new Date().toISOString()
    });
    
    // Check if we have at least one credential
    if (!token && !shortCode) {
      console.log('❌ No credentials provided');
      return res.status(400).json({
        valid: false,
        error: 'Token or short code is required'
      });
    }
    
    // 🔍 **DEBUG: Check all invites in database first**
    const allInvites = await PartnerInvite.find({});
    console.log(`📊 Total invites in database: ${allInvites.length}`);
    
    // Log each invite for debugging
    allInvites.forEach(invite => {
      console.log('📋 Invite found:', {
        shortCode: invite.shortCode,
        email: invite.email,
        used: invite.used,
        expiresAt: invite.expiresAt,
        isExpired: invite.expiresAt < new Date()
      });
    });
    
    // Create the query
    let query = {
      used: false,
      expiresAt: { $gt: new Date() }
    };
    
    // Build OR condition
    if (token && shortCode) {
      query.$or = [
        { token: token.trim() },
        { shortCode: shortCode.trim().toUpperCase() }
      ];
    } else if (token) {
      query.token = token.trim();
    } else if (shortCode) {
      query.shortCode = shortCode.trim().toUpperCase();
    }
    
    console.log('🔍 Database query:', JSON.stringify(query, null, 2));
    
    // Execute query
    const invite = await PartnerInvite.findOne(query);
    
    console.log('🔍 Query result:', invite ? 'Found invite!' : 'No invite found');
    
    if (!invite) {
      console.log('❌ No valid invite found for:', { token, shortCode });
      
      // Check why it failed
      const expiredInvite = await PartnerInvite.findOne({
        $or: [
          { token: token?.trim() },
          { shortCode: shortCode?.trim().toUpperCase() }
        ]
      });
      
      if (expiredInvite) {
        console.log('⚠️ Invite exists but:', {
          used: expiredInvite.used,
          expired: expiredInvite.expiresAt < new Date(),
          expiresAt: expiredInvite.expiresAt
        });
      }
      
      return res.status(400).json({
        valid: false,
        error: 'Invalid or expired credentials. Please contact support for a new invitation.',
        debug: {
          hasMatchingInvite: !!expiredInvite,
          isUsed: expiredInvite?.used,
          isExpired: expiredInvite?.expiresAt < new Date(),
          expiresAt: expiredInvite?.expiresAt
        }
      });
    }

    console.log('✅ Valid invite found:', {
      email: invite.email,
      shortCode: invite.shortCode,
      expiresAt: invite.expiresAt,
      daysUntilExpiry: Math.ceil((invite.expiresAt - new Date()) / (1000 * 60 * 60 * 24))
    });

    // Check if email is already registered as partner
    const existingPartner = await Partner.findOne({ email: invite.email });
    if (existingPartner) {
      console.log('⚠️ Email already registered:', {
        email: invite.email,
        partnerId: existingPartner._id,
        status: existingPartner.status
      });
      
      return res.status(400).json({
        valid: false,
        error: 'This email is already registered as a partner. Please try logging in instead.',
        partnerExists: true,
        partnerId: existingPartner._id,
        partnerStatus: existingPartner.status
      });
    }

    // Success response
    res.json({
      valid: true,
      email: invite.email || '',
      expiresAt: invite.expiresAt,
      daysValid: Math.ceil((invite.expiresAt - new Date()) / (1000 * 60 * 60 * 24)),
      inviteData: {
        id: invite._id,
        createdBy: invite.createdBy,
        createdAt: invite.createdAt,
        expiresAt: invite.expiresAt,
        shortCode: invite.shortCode
      }
    });
    
  } catch (error) {
    console.error('❌ Verification error:', error);
    res.status(500).json({
      valid: false,
      error: 'Server error during verification',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
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
// Get all partners for admin - FIXED
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
      .select('name email referralCode status createdAt commission referralClicks lastClickAt')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Partner.countDocuments(query);

    // ✅ FIX: Convert commission from cents to euros
    const formattedPartners = partners.map(partner => ({
      ...partner.toObject(),
      commissionEarned: (partner.commission?.earned || 0) / 100,
      commissionPaid: (partner.commission?.paid || 0) / 100,
      commissionAvailable: (partner.commission?.available || 0) / 100
    }));

    res.json({
      success: true,
      count: formattedPartners.length,
      total,
      page: Number(page),
      pages: Math.ceil(total / limit),
      partners: formattedPartners
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to fetch partners'
    });
  }
};

// Get detailed partner info for admin - UPDATED
// Get detailed partner info for admin - FIXED VERSION
exports.getAdminPartnerDetails = async (req, res) => {
  try {
    console.log('🔄 ADMIN: Starting getAdminPartnerDetails for ID:', req.params.id);

    // Find the partner with all related data
    const partner = await Partner.findById(req.params.id)
      .select('-password')
      .lean();

    if (!partner) {
      return res.status(404).json({
        success: false,
        error: 'Partner not found'
      });
    }

    console.log('✅ Found partner:', partner.email);

    // ========== GET REFERRED CLIENTS ==========
    let clients = [];
    try {
      clients = await Client.find({ 
        $or: [
          { referredBy: partner._id },
          { referralCode: partner.referralCode }
        ]
      })
      .select('name email phone createdAt status')
      .sort({ createdAt: -1 })
      .lean();
      
      console.log(`✅ Found ${clients.length} referred clients`);
    } catch (clientError) {
      console.log('⚠️ Could not fetch clients:', clientError.message);
    }

    // ========== GET REFERRED ORDERS ==========
    let orders = [];
    try {
      // GET ALL ORDERS, not just completed ones
      orders = await Order.find({ 
        'referralInfo.referredBy': partner._id
      })
      .select('plan originalPrice finalPrice customerDetails commission status createdAt')
      .sort({ createdAt: -1 })
      .lean();
      
      console.log(`✅ Found ${orders.length} referred orders (all statuses)`);
      
      // ✅ FIX: Properly handle prices and commissions
      orders = orders.map(order => {
        const orderObj = order;
        
        // Convert from cents to euros
        const originalPriceInEuros = (order.originalPrice || 0) / 100;
        const finalPriceInEuros = (order.finalPrice || 0) / 100;
        
        orderObj.originalPrice = originalPriceInEuros; // €3,900
        orderObj.finalPrice = finalPriceInEuros;       // €3,900 (customer pays full price)
        
        // ✅ FIX: Use the commission from database or calculate
        // Check if commission exists in order data
        let commissionAmount = 400; // Default to €400
        let commissionStatus = 'pending';
        
        if (order.commission && order.commission.amount) {
          // If commission is stored in cents, convert to euros
          commissionAmount = order.commission.amount > 100 ? order.commission.amount / 100 : order.commission.amount;
          commissionStatus = order.commission.status || 'pending';
        }
        
        orderObj.commission = {
          amount: commissionAmount, // €400
          status: commissionStatus,
          description: 'Fixed commission per completed order'
        };
        
        // Calculate business net revenue (what business actually earns after commission)
        orderObj.businessNetRevenue = originalPriceInEuros - commissionAmount;
        
        // Add price breakdown for clarity
        orderObj.priceBreakdown = {
          customerPaid: originalPriceInEuros,
          partnerCommission: commissionAmount,
          businessNet: originalPriceInEuros - commissionAmount,
          commissionType: 'fixed',
          currency: 'EUR'
        };
        
        return orderObj;
      });
      
    } catch (orderError) {
      console.log('⚠️ Could not fetch orders:', orderError.message);
    }

    // ========== CALCULATE TOTALS ==========
    // Calculate total sales from orders (now in euros)
    const totalSales = orders.reduce((sum, order) => {
      return sum + (order.originalPrice || 0);
    }, 0);

    // Calculate completed orders and commission (in euros)
    const completedOrders = orders.filter(order => order.status === 'completed');
    const totalCommission = completedOrders.reduce((sum, order) => {
      return sum + (order.commission?.amount || 0);
    }, 0);

    // Calculate total business net revenue
    const totalBusinessNetRevenue = completedOrders.reduce((sum, order) => {
      return sum + (order.businessNetRevenue || 0);
    }, 0);

    // ========== DYNAMIC URL GENERATION ==========
    // Get the current host to determine environment
    const host = req.get('host');
    console.log('🌐 ADMIN Request Host:', host);
    
    // Determine backend URL based on request host
    const getDynamicBackendUrl = () => {
      if (host && (host.includes('localhost') || host.includes('127.0.0.1'))) {
        console.log('📍 ADMIN: Detected localhost environment');
        return 'http://localhost:3000';
      } else if (host && host.includes('hk-backend-tau.vercel.app')) {
        console.log('📍 ADMIN: Detected Vercel production environment');
        return 'https://hk-backend-tau.vercel.app';
      } else {
        console.log('📍 ADMIN: Using default production URL');
        return 'https://hk-backend-tau.vercel.app';
      }
    };
    
    // Generate dynamic referral link
    const backendUrl = getDynamicBackendUrl();
    const dynamicReferralLink = `${backendUrl}/api/partner-auth/track-click/${partner.referralCode}`;

    console.log('🔗 Generated dynamic referral link:', {
      backendUrl,
      dynamicReferralLink,
      storedLink: partner.referralLink
    });

    // ✅ FIX: Properly extract commission data from partner model
    const partnerCommissionData = partner.commission || {};
    
    const responseData = {
      partner: {
        // Basic info
        _id: partner._id,
        name: partner.name,
        email: partner.email,
        referralCode: partner.referralCode || 'N/A',
        referralLink: dynamicReferralLink, // ✅ USE DYNAMIC LINK HERE
        status: partner.status || 'active',
        createdAt: partner.createdAt,
        
        // Click stats
        referralClicks: partner.referralClicks || 0,
        lastClickAt: partner.lastClickAt,
        
        // ✅ FIX: Commission fields - convert from cents to euros
        commissionEarned: (partnerCommissionData.earned || 0) / 100, // Convert to euros
        commissionPaid: (partnerCommissionData.paid || 0) / 100,     // Convert to euros
        availableCommission: (partnerCommissionData.available || 0) / 100, // Convert to euros
        commissionOnHold: (partnerCommissionData.onHold || 0) / 100, // Convert to euros
        
        // For frontend compatibility - show fixed €400 commission
        commissionRate: '€400',
        commissionPerOrder: 400,
        
        // Add commission history if exists
        commissionHistory: partnerCommissionData.history || []
      },
      clients: clients || [],
      orders: orders || [],
      
      // Sales statistics
      totalSales: totalSales || 0,
      totalCompletedSales: completedOrders.reduce((sum, order) => sum + (order.originalPrice || 0), 0),
      totalCommission: totalCommission || 0,
      totalBusinessNetRevenue: totalBusinessNetRevenue || 0,
      
      // Order counts
      totalOrders: orders.length,
      completedOrders: completedOrders.length,
      pendingOrders: orders.filter(order => order.status !== 'completed').length,
      
      // Business model explanation
      businessModel: {
        pricing: 'Customer pays full price (€3,900)',
        commission: 'Partner receives €400 per completed order',
        businessNet: 'Business earns €3,500 after commission',
        commissionSource: 'Commission paid from business revenue',
        currency: 'EUR'
      }
    };

    console.log('✅ Sending partner details with dynamic link:', {
      partnerName: responseData.partner.name,
      referralLink: responseData.partner.referralLink,
      totalSales: responseData.totalSales,
      totalCommission: responseData.totalCommission,
      totalOrders: responseData.totalOrders
    });

    res.json({
      success: true,
      data: responseData,
      
      // Add metadata for frontend
      metadata: {
        pricingModel: 'fixed-commission-from-business-revenue',
        description: 'Customer pays full price. Partner commission is deducted from business revenue.',
        lastUpdated: new Date(),
        currency: 'EUR'
      }
    });

  } catch (error) {
    console.error('❌ ERROR in getAdminPartnerDetails:', error);
    
    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        error: 'Invalid partner ID format'
      });
    }

    res.status(500).json({
      success: false,
      error: 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};
// Debug partner orders
exports.debugPartnerOrders = async (req, res) => {
  try {
    const partnerId = req.params.id;
    
    console.log(`🔍 Debugging orders for partner: ${partnerId}`);
    
    const partner = await Partner.findById(partnerId);
    if (!partner) {
      return res.status(404).json({
        success: false,
        error: 'Partner not found'
      });
    }
    
    // Get all clients referred by this partner
    const clients = await Client.find({ referredBy: partner._id });
    console.log(`📋 Partner has ${clients.length} referred clients`);
    
    // Get all orders for these clients
    const clientIds = clients.map(c => c._id);
    const clientOrders = await Order.find({ client: { $in: clientIds } });
    
    // Get orders directly linked to partner
    const linkedOrders = await Order.find({ 
      'referralInfo.referredBy': partner._id 
    });
    
    // Check order commission
    const ordersWithCommission = await Order.find({ 
      'referralInfo.referredBy': partner._id,
      'commission.amount': { $gt: 0 }
    });
    
    res.json({
      success: true,
      partner: {
        name: partner.name,
        email: partner.email,
        referralCode: partner.referralCode,
        commissionEarned: partner.commission?.earned || 0,
        commissionAvailable: partner.commission?.available || 0
      },
      stats: {
        referredClients: clients.length,
        clientEmails: clients.map(c => c.email),
        ordersByClient: clientOrders.length,
        ordersLinked: linkedOrders.length,
        ordersWithCommission: ordersWithCommission.length
      },
      clientOrders: clientOrders.map(o => ({
        id: o._id,
        clientEmail: o.customerDetails?.email,
        clientType: o.clientType,
        status: o.status,
        amount: o.finalPrice / 100,
        commission: o.commission?.amount / 100 || 0,
        hasReferralInfo: !!o.referralInfo?.referredBy,
        referredByMatches: o.referralInfo?.referredBy?.toString() === partnerId
      })),
      linkedOrders: linkedOrders.map(o => ({
        id: o._id,
        clientEmail: o.customerDetails?.email,
        status: o.status,
        amount: o.finalPrice / 100,
        commission: o.commission?.amount / 100 || 0,
        commissionStatus: o.commission?.status
      }))
    });
    
  } catch (error) {
    console.error('Debug error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
};

// Fix partner orders
exports.fixPartnerOrders = async (req, res) => {
  try {
    const partnerId = req.params.id;
    
    console.log(`🔧 Fixing orders for partner: ${partnerId}`);
    
    const partner = await Partner.findById(partnerId);
    if (!partner) {
      return res.status(404).json({
        success: false,
        error: 'Partner not found'
      });
    }
    
    // Get all clients referred by this partner
    const clients = await Client.find({ referredBy: partner._id });
    console.log(`📋 Found ${clients.length} clients referred by ${partner.name}`);
    
    let fixedOrders = 0;
    let totalCommission = 0;
    
    // For each client, find their orders and link to partner
    for (const client of clients) {
      const clientOrders = await Order.find({ client: client._id });
      
      for (const order of clientOrders) {
        // Check if order is already linked to partner
        if (!order.referralInfo?.referredBy || 
            order.referralInfo.referredBy.toString() !== partner._id.toString()) {
          
          // Update order with referral info
          order.referralInfo = {
            referralCode: partner.referralCode,
            referredBy: partner._id,
            partnerName: partner.name,
            partnerEmail: partner.email,
            commissionProcessed: false
          };
          
          // Set commission for referral orders
          if (order.clientType !== 'REFERRAL') {
            order.clientType = 'REFERRAL';
          }
          
          // Set commission amount
          if (!order.commission?.amount || order.commission.amount === 0) {
            order.commission = {
              amount: 40000, // €400 in cents
              status: order.status === 'completed' ? 'approved' : 'pending'
            };
            
            // Update partner commission if order is completed
            if (order.status === 'completed') {
              partner.commission.earned = (partner.commission.earned || 0) + 40000;
              partner.commission.available = (partner.commission.available || 0) + 40000;
              totalCommission += 40000;
            }
          }
          
          await order.save();
          fixedOrders++;
          
          // Update partner referral stats
          partner.referrals.orders = partner.referrals.orders || [];
          if (!partner.referrals.orders.includes(order._id)) {
            partner.referrals.orders.push(order._id);
          }
          partner.referrals.totalOrders = (partner.referrals.totalOrders || 0) + 1;
          partner.referrals.totalSales = (partner.referrals.totalSales || 0) + (order.finalPrice || 0);
          
          console.log(`✅ Fixed order ${order._id} for client ${client.email}`);
        }
      }
    }
    
    // Save partner updates
    await partner.save();
    
    console.log(`✅ Fixed ${fixedOrders} orders for partner ${partner.name}`);
    console.log(`💰 Added €${totalCommission / 100} commission`);
    
    res.json({
      success: true,
      message: `Fixed ${fixedOrders} orders for ${partner.name}`,
      data: {
        partner: partner.name,
        email: partner.email,
        fixedOrders: fixedOrders,
        totalCommissionAdded: totalCommission / 100,
        newCommissionEarned: partner.commission.earned / 100,
        newCommissionAvailable: partner.commission.available / 100,
        totalClients: clients.length,
        totalOrders: partner.referrals.totalOrders || 0,
        totalSales: partner.referrals.totalSales || 0
      }
    });
    
  } catch (error) {
    console.error('Fix script error:', error);
    res.status(500).json({
      success: false,
      error: error.message
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

// ========== STRIPE CONNECT FUNCTIONS ==========

// Check partner's Stripe Connect status
exports.checkPartnerStripeStatus = async (req, res) => {
  try {
    const partnerId = req.params.partnerId || req.params.id;
    
    const partner = await Partner.findById(partnerId);
    if (!partner) {
      return res.status(404).json({
        success: false,
        error: 'Partner not found'
      });
    }
    
    let stripeAccount = null;
    let hasStripeConnect = false;
    let accountStatus = 'not_connected';
    
    // Check if using old field name (stripeAccountId)
    const accountId = partner.stripeConnect?.accountId || partner.stripeAccountId;
    
    if (accountId) {
      try {
        stripeAccount = await stripe.accounts.retrieve(accountId);
        hasStripeConnect = true;
        accountStatus = stripeAccount.charges_enabled ? 'active' : 'pending';
        
        // Update partner with correct field names
        partner.stripeConnect = {
          accountId: accountId,
          status: accountStatus,
          chargesEnabled: stripeAccount.charges_enabled,
          payoutsEnabled: stripeAccount.payouts_enabled,
          detailsSubmitted: stripeAccount.details_submitted
        };
        
        await partner.save();
      } catch (stripeError) {
        console.error('Stripe account retrieval error:', stripeError.message);
        accountStatus = 'error';
      }
    }
    
    res.json({
      success: true,
      data: {
        partner: {
          name: partner.name,
          email: partner.email,
          referralCode: partner.referralCode,
          hasStripeConnect: hasStripeConnect,
          accountId: accountId,
          accountStatus: accountStatus
        },
        stripeConnect: partner.stripeConnect || {
          accountId: null,
          status: 'not_connected',
          chargesEnabled: false,
          payoutsEnabled: false
        },
        stripeAccount: stripeAccount ? {
          id: stripeAccount.id,
          charges_enabled: stripeAccount.charges_enabled,
          payouts_enabled: stripeAccount.payouts_enabled,
          requirements: stripeAccount.requirements,
          capabilities: stripeAccount.capabilities,
          details_submitted: stripeAccount.details_submitted
        } : null
      }
    });
    
  } catch (error) {
    console.error('Check Stripe status error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Setup Stripe Connect for partner (ADMIN)
exports.setupStripeConnectForPartner = async (req, res) => {
  try {
    const partnerId = req.params.partnerId || req.params.id;
    
    const partner = await Partner.findById(partnerId);
    if (!partner) {
      return res.status(404).json({
        success: false,
        error: 'Partner not found'
      });
    }
    
    // Check if partner already has Stripe Connect
    const existingAccountId = partner.stripeConnect?.accountId || partner.stripeAccountId;
    if (existingAccountId) {
      return res.status(400).json({
        success: false,
        error: 'Partner already has Stripe Connect account',
        accountId: existingAccountId
      });
    }
    
    // Create Stripe Connect Express account
    const account = await stripe.accounts.create({
      type: 'express',
      country: 'FR', // Partner's country code
      email: partner.email,
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
      business_type: 'individual',
      individual: {
        email: partner.email,
        first_name: partner.name.split(' ')[0] || partner.name,
        last_name: partner.name.split(' ').slice(1).join(' ') || '',
        phone: '+33123456789', // Default, partner can update
        address: {
          line1: 'Not provided',
          city: 'Paris',
          postal_code: '75000',
          country: 'FR'
        }
      },
      settings: {
        payouts: {
          schedule: {
            interval: 'manual'
          }
        }
      },
      metadata: {
        partnerId: partner._id.toString(),
        partnerEmail: partner.email,
        referralCode: partner.referralCode
      }
    });
    
    console.log(`✅ Stripe Connect account created: ${account.id} for ${partner.email}`);
    
    // Save to partner with CORRECT field name (stripeConnect)
    partner.stripeConnect = {
      accountId: account.id,
      status: 'pending',
      chargesEnabled: false,
      payoutsEnabled: false,
      detailsSubmitted: false
    };
    
    // Remove old field if exists
    if (partner.stripeAccountId) {
      delete partner.stripeAccountId;
      delete partner.stripeAccountStatus;
      delete partner.stripeOnboardingCompleted;
    }
    
    await partner.save();
    
    // Create onboarding link
    const accountLink = await stripe.accountLinks.create({
      account: account.id,
      refresh_url: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/partner/dashboard?refresh=stripe`,
      return_url: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/partner/dashboard?success=stripe`,
      type: 'account_onboarding',
      collection_options: {
        fields: 'currently_due',
        future_requirements: 'include'
      }
    });
    
    res.json({
      success: true,
      message: 'Stripe Connect account created successfully',
      partner: {
        name: partner.name,
        email: partner.email,
        referralCode: partner.referralCode,
        stripeAccountId: account.id
      },
      onboardingUrl: accountLink.url,
      instructions: 'Share this URL with the partner to complete Stripe Connect setup'
    });
    
  } catch (error) {
    console.error('Stripe Connect setup error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Get Stripe Connect onboarding link (for partner)
exports.getStripeOnboardingLink = async (req, res) => {
  try {
    const partnerId = req.partner?.id || req.user?.id;
    
    const partner = await Partner.findById(partnerId);
    if (!partner) {
      return res.status(404).json({
        success: false,
        error: 'Partner not found'
      });
    }
    
    // Check if partner has Stripe Connect account
    const accountId = partner.stripeConnect?.accountId || partner.stripeAccountId;
    if (!accountId) {
      return res.status(400).json({
        success: false,
        error: 'Partner does not have Stripe Connect account. Please contact admin to set it up.'
      });
    }
    
    // Create onboarding link
    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/partner/dashboard?refresh=stripe`,
      return_url: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/partner/dashboard?success=stripe`,
      type: 'account_onboarding',
      collection_options: {
        fields: 'currently_due',
        future_requirements: 'include'
      }
    });
    
    res.json({
      success: true,
      onboardingUrl: accountLink.url,
      partner: {
        name: partner.name,
        email: partner.email,
        stripeAccountId: accountId,
        chargesEnabled: partner.stripeConnect?.chargesEnabled || false,
        payoutsEnabled: partner.stripeConnect?.payoutsEnabled || false
      }
    });
    
  } catch (error) {
    console.error('Get onboarding link error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

// Get partner's Stripe balance
exports.getStripeBalance = async (req, res) => {
  try {
    const partnerId = req.partner?.id || req.user?.id;
    
    const partner = await Partner.findById(partnerId);
    if (!partner) {
      return res.status(404).json({
        success: false,
        error: 'Partner not found'
      });
    }
    
    // Check if partner has Stripe Connect
    const accountId = partner.stripeConnect?.accountId || partner.stripeAccountId;
    if (!accountId) {
      return res.json({
        success: true,
        hasStripeConnect: false,
        message: 'Partner does not have Stripe Connect account'
      });
    }
    
    // Get balance from Stripe
    const balance = await stripe.balance.retrieve({
      stripeAccount: accountId
    });
    
    // Get available balance (can be transferred to bank)
    const availableBalance = balance.available[0]?.amount || 0;
    const pendingBalance = balance.pending[0]?.amount || 0;
    
    res.json({
      success: true,
      hasStripeConnect: true,
      balance: {
        available: availableBalance / 100, // Convert to euros
        pending: pendingBalance / 100,     // Convert to euros
        currency: 'eur',
        total: (availableBalance + pendingBalance) / 100
      },
      accountStatus: {
        accountId: accountId,
        chargesEnabled: partner.stripeConnect?.chargesEnabled || false,
        payoutsEnabled: partner.stripeConnect?.payoutsEnabled || false,
        detailsSubmitted: partner.stripeConnect?.detailsSubmitted || false,
        status: partner.stripeConnect?.status || 'pending'
      }
    });
    
  } catch (error) {
    console.error('Get balance error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

// Sync Stripe account status (update from Stripe)
exports.syncStripeAccountStatus = async (req, res) => {
  try {
    const partnerId = req.params.partnerId || req.params.id;
    
    const partner = await Partner.findById(partnerId);
    if (!partner) {
      return res.status(404).json({
        success: false,
        error: 'Partner not found'
      });
    }
    
    const accountId = partner.stripeConnect?.accountId || partner.stripeAccountId;
    if (!accountId) {
      return res.status(400).json({
        success: false,
        error: 'Partner does not have Stripe Connect account'
      });
    }
    
    // Retrieve account from Stripe
    const account = await stripe.accounts.retrieve(accountId);
    
    // Update partner with latest status
    partner.stripeConnect = {
      accountId: account.id,
      status: account.charges_enabled ? 'active' : 'pending',
      chargesEnabled: account.charges_enabled,
      payoutsEnabled: account.payouts_enabled,
      detailsSubmitted: account.details_submitted
    };
    
    await partner.save();
    
    res.json({
      success: true,
      message: 'Stripe account status synced',
      partner: {
        name: partner.name,
        email: partner.email,
        stripeConnect: partner.stripeConnect
      }
    });
    
  } catch (error) {
    console.error('Sync account error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

// Test instant transfer for partner
exports.testInstantTransfer = async (req, res) => {
  try {
    const partnerId = req.params.partnerId || req.params.id;
    
    const partner = await Partner.findById(partnerId);
    if (!partner) {
      return res.status(404).json({
        success: false,
        error: 'Partner not found'
      });
    }
    
    const accountId = partner.stripeConnect?.accountId || partner.stripeAccountId;
    
    res.json({
      success: true,
      partner: {
        name: partner.name,
        email: partner.email,
        hasStripeConnect: !!accountId,
        accountId: accountId,
        status: partner.stripeConnect?.status || 'not_connected',
        chargesEnabled: partner.stripeConnect?.chargesEnabled || false,
        payoutsEnabled: partner.stripeConnect?.payoutsEnabled || false
      },
      instantTransfer: {
        willWork: !!(accountId && partner.stripeConnect?.chargesEnabled),
        message: accountId 
          ? (partner.stripeConnect?.chargesEnabled 
            ? '✅ Instant €400 transfer WILL work for this partner' 
            : '❌ Partner needs to complete Stripe Connect onboarding')
          : '❌ Partner has no Stripe Connect account',
        actionRequired: !accountId 
          ? 'Setup Stripe Connect for partner'
          : (!partner.stripeConnect?.chargesEnabled 
            ? 'Partner must complete onboarding'
            : 'Ready for instant transfers!')
      }
    });
    
  } catch (error) {
    console.error('Test instant transfer error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};
