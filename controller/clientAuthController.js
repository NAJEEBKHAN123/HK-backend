const Client = require("../model/Client");
const Partner = require("../model/Partner");
const jwt = require("jsonwebtoken");
const validator = require("validator");
const Order = require("../model/Order");

exports.clientSignup = async (req, res) => {
  try {
    const { name, email, password, referralCode } = req.body;

    // Validation
    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        error: "Name, email and password are required",
      });
    }

    if (!validator.isEmail(email)) {
      return res.status(400).json({
        success: false,
        error: "Invalid email format",
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        error: "Password must be at least 8 characters",
      });
    }

    // Check for existing client
    const existingClient = await Client.findOne({ email });
    if (existingClient) {
      return res.status(409).json({
        success: false,
        error: "Email already registered",
      });
    }

    // Initialize client data
    const clientData = {
      name,
      email,
      password,
      source: "DIRECT", // Default
      referredBy: null,
      referralCode: null,
    };

    // Handle referral if code provided
    if (referralCode) {
      const partner = await Partner.findOne({
        referralCode,
        status: "active",
      });

      if (partner) {
        clientData.source = "REFERRAL";
        clientData.referredBy = partner._id;
        clientData.referralCode = referralCode;
        
        // ✅ NO CLICK COUNTING HERE - Clicks are already counted in trackClick()
        // Clicks should ONLY be counted when someone clicks the link, not when they sign up
      }
    }

    // Create client
    const client = await Client.create(clientData);

    // Update partner if referral (add client to partner's referred clients)
    if (client.source === "REFERRAL") {
      await Partner.findByIdAndUpdate(client.referredBy, {
        $addToSet: { clientsReferred: client._id },
      });
      
      console.log(`✅ Client ${email} added to partner's referred clients`);
    }

    // Create JWT
    const token = jwt.sign(
      {
        id: client._id,
        role: "client",
        source: client.source,
      },
      process.env.JWT_SECRET,
      { expiresIn: "30d" }
    );

    res.status(201).json({
      success: true,
      token,
      client: {
        id: client._id,
        name: client.name,
        email: client.email,
        source: client.source,
        referralCode: client.referralCode,
      },
    });
  } catch (error) {
    console.error("Signup error:", error);
    res.status(500).json({
      success: false,
      error: "Registration failed",
    });
  }
};

exports.clientLogin = async (req, res) => {
  try {
    const { email, password } = req.body;

    const client = await Client.findOne({ email }).select("+password");
    if (!client) {
      return res.status(401).json({
        success: false,
        error: "Invalid credentials",
      });
    }

    const isMatch = await client.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        error: "Invalid credentials",
      });
    }

    const token = jwt.sign(
      {
        id: client._id,
        role: "client",
        source: client.source,
      },
      process.env.JWT_SECRET,
      { expiresIn: "30d" }
    );

    res.json({
      success: true,
      token,
      client: {
        id: client._id,
        name: client.name,
        email: client.email,
        source: client.source,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Login failed",
    });
  }
};

// Get all clients
// In controller/clientAuthController.js - Update getAllClients
exports.getAllClients = async (req, res) => {
  try {
    console.log('📊 getAllClients called by admin:', req.admin?.email);
    
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const search = req.query.search || '';
    
    const skip = (page - 1) * limit;
    
    let query = {};
    if (search) {
      query = {
        $or: [
          { name: { $regex: search, $options: 'i' } },
          { email: { $regex: search, $options: 'i' } },
          { referralCode: { $regex: search, $options: 'i' } }
        ]
      };
    }
    
    const clients = await Client.find(query)
      .populate('referredBy', 'name email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);
    
    // Get orders for each client
    const clientsWithOrders = await Promise.all(
      clients.map(async (client) => {
        const orders = await Order.find({ client: client._id });
        const totalSpend = orders.reduce((sum, order) => {
          return sum + (order.finalPrice || order.originalPrice || 0);
        }, 0);
        
        return {
          ...client.toObject(),
          orders: orders,
          totalOrders: orders.length,
          totalSpend: totalSpend
        };
      })
    );
    
    const total = await Client.countDocuments(query);
    const pages = Math.ceil(total / limit);
    
    console.log(`✅ Found ${total} clients, returning ${clientsWithOrders.length}`);
    
    res.status(200).json({
      success: true,
      message: "All clients fetched successfully",
      data: clientsWithOrders,
      total,
      pages,
      page
    });
  } catch (error) {
    console.error("❌ Error in getAllClients:", error);
    res.status(500).json({
      success: false,
      message: "Error in fetching clients",
      error: error.message
    });
  }
};

// ✅ UPDATED: Now includes orders with detailed calculations
exports.getClientForPartner = async (req, res) => {
  try {
    const client = await Client.findOne({
      _id: req.params.id,
      referredBy: req.partner._id // Ensure partner only sees their referred clients
    })
    .populate('referredBy', 'name email');

    if (!client) {
      return res.status(404).json({
        success: false,
        error: "Client not found or not referred by you"
      });
    }

    // ✅ IMPORTANT: Fetch orders for this client that were referred by this partner
    const orders = await Order.find({ 
      client: req.params.id,
      referredBy: req.partner._id
    })
    .select('-stripeSessionId -paymentIntentId -isCommissionProcessed -__v')
    .sort({ createdAt: -1 });

    // ✅ Calculate detailed statistics
    const totalOrders = orders.length;
    const totalSpend = orders.reduce((sum, order) => {
      return sum + (order.finalPrice || order.originalPrice || 0);
    }, 0);
    
    const totalCommission = orders.reduce((sum, order) => {
      return sum + (order.partnerCommission || 0);
    }, 0);
    
    const averageOrder = totalOrders > 0 ? totalSpend / totalOrders : 0;

    // Prepare client data with orders and statistics
    const clientData = {
      ...client.toObject(),
      orders: orders,
      totalOrders,
      totalSpend,
      totalCommission,
      averageOrder
    };

    console.log('✅ Client details for partner fetched:', {
      clientId: req.params.id,
      partnerId: req.partner._id,
      totalOrders,
      totalSpend,
      totalCommission
    });

    res.status(200).json({
      success: true,
      data: clientData
    });
  } catch (error) {
    console.error('❌ Error in getClientForPartner:', error);
    res.status(500).json({
      success: false,
      error: "Server error"
    });
  }
};

exports.getClient = async (req, res) => {
  const id = req.params.id;
  try {
    const client = await Client.findById(id)
      .populate('referredBy', 'name email');
    
    if (!client) {
      return res.status(404).json({
        success: false,
        message: "Client not found",
      });
    }
    
    // Also fetch orders for this client
    const orders = await Order.find({ client: id })
      .select('-stripeSessionId -paymentIntentId -isCommissionProcessed -__v')
      .sort({ createdAt: -1 });
    
    const totalSpend = orders.reduce((total, order) => {
      return total + (order.finalPrice || order.originalPrice || 0);
    }, 0);
    
    return res.status(200).json({
      success: true,
      message: "Client fetched successfully",
      data: {
        ...client.toObject(),
        orders: orders,
        totalOrders: orders.length,
        totalSpend: totalSpend
      },
    });
  } catch (error) {
    console.error("Error in fetching client:", error);
    return res.status(500).json({
      success: false,
      message: "Error in fetching client",
      error: error.message
    });
  }
};

exports.deleteClient = async (req, res) => {
  const id = req.params.id;
  try {
    const client = await Client.findByIdAndDelete(id);
    if (!client) {
      res.status(404).json({
        success: false,
        message: "Error in deleting client",
      });
      res.status(200).json({
        success: true,
        message: "Delete client successfully",
      });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: "Failed to delete client" });
  }
};

exports.updateClient = async (req, res) => {
  const { id } = params.id;

  try {
    const client = await Client.findByIdAndUpdate(id, req.body, { new: true });
    res.status(200).json({
      success: true,
      message: "Client update successfully",
      data: client
    })
  } catch (error) {
     console.log('Failed to update client')
     res.status(500).json({ success: false, error: 'Failed to update client' });
  }
};

exports.updateClientStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    
    const client = await Client.findByIdAndUpdate(
      id, 
      { status },
      { new: true }
    );
    
    if (!client) {
      return res.status(404).json({
        success: false,
        error: "Client not found"
      });
    }
    
    res.status(200).json({
      success: true,
      message: "Client status updated",
      data: client
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Failed to update client status"
    });
  }
};

exports.getClientOrders = async (req, res) => {
  try {
    const { id } = req.params;
    
    // First verify the client exists
    const client = await Client.findById(id);
    if (!client) {
      return res.status(404).json({
        success: false,
        message: "Client not found",
      });
    }
    
    // Find all orders for this client
    const orders = await Order.find({ client: id })
      .select('-stripeSessionId -paymentIntentId -isCommissionProcessed -__v')
      .populate('referredBy', 'name email')
      .sort({ createdAt: -1 });
    
    // Calculate total spend (in cents)
    const totalSpend = orders.reduce((total, order) => {
      return total + (order.finalPrice || order.originalPrice || 0);
    }, 0);
    
    // Calculate total commission
    const totalCommission = orders.reduce((total, order) => {
      return total + (order.partnerCommission || 0);
    }, 0);
    
    return res.status(200).json({
      success: true,
      message: "Client orders fetched successfully",
      data: orders,
      count: orders.length,
      totalSpend: totalSpend,
      totalCommission: totalCommission,
      totalSpendDisplay: `$${(totalSpend / 100).toFixed(2)}`
    });
  } catch (error) {
    console.error("Error fetching client orders:", error);
    return res.status(500).json({
      success: false,
      message: "Error fetching client orders",
      error: error.message
    });
  }
};

// ✅ NEW: Get detailed client information for partner with orders
// In clientAuthController.js - Update getClientDetailsForPartner
exports.getClientDetailsForPartner = async (req, res) => {
  try {
    const { id } = req.params;
    
    console.log('🔍 Getting client details for partner:', {
      clientId: id,
      partnerId: req.partner._id
    });

    // Verify client belongs to this partner
    const client = await Client.findOne({
      _id: id,
      referredBy: req.partner._id
    }).select('name email phone clientType status createdAt referredBy');

    if (!client) {
      console.log('❌ Client not found or not referred by this partner');
      return res.status(404).json({
        success: false,
        error: "Client not found or not referred by you"
      });
    }

    console.log('✅ Client found:', client.email);

    // Get ALL orders for this client where partner is the referrer
    const orders = await Order.find({ 
      'referralInfo.referredBy': req.partner._id,
      client: id
    })
    .select('plan originalPrice finalPrice status commission customerDetails referralInfo createdAt')
    .sort({ createdAt: -1 })
    .lean(); // Use lean() for better performance
    
    console.log(`✅ Found ${orders.length} orders for client ${client.email}`);

    // ✅ FIX: Calculate commission for each order
    const ordersWithCommission = orders.map(order => {
      const orderObj = { ...order };
      
      // Convert prices from cents to euros for frontend
      orderObj.originalPrice = (order.originalPrice || 0) / 100;
      orderObj.finalPrice = (order.finalPrice || 0) / 100;
      
      // ✅ FIX: Calculate commission (€400 for completed orders)
      let commissionAmount = 0;
      let commissionStatus = 'pending';
      
      if (order.status === 'completed') {
        // Check if commission already exists in order
        if (order.commission && order.commission.amount) {
          commissionAmount = order.commission.amount > 100 ? order.commission.amount / 100 : order.commission.amount;
          commissionStatus = order.commission.status || 'pending';
        } else {
          // Default €400 commission for completed referral orders
          commissionAmount = 400; // €400 in euros
          commissionStatus = 'approved';
        }
      }
      
      orderObj.commission = {
        amount: commissionAmount,
        status: commissionStatus,
        display: `€${commissionAmount.toFixed(2)}`
      };
      
      // Add partner commission to order for frontend
      orderObj.partnerCommission = commissionAmount;
      
      return orderObj;
    });
    
    // Calculate totals
    const totalOrders = orders.length;
    const completedOrders = orders.filter(o => o.status === 'completed').length;
    
    // Total spend in euros
    const totalSpend = orders.reduce((total, order) => {
      return total + ((order.finalPrice || order.originalPrice || 0) / 100);
    }, 0);
    
    // Total commission in euros
    const totalCommission = ordersWithCommission.reduce((total, order) => {
      return total + (order.partnerCommission || 0);
    }, 0);

    console.log('💰 Calculated totals:', {
      totalOrders,
      completedOrders,
      totalSpend,
      totalCommission
    });

    return res.status(200).json({
      success: true,
      data: {
        ...client.toObject(),
        orders: ordersWithCommission,
        totalOrders,
        completedOrders,
        totalSpend,
        totalCommission,
        // Keep raw values for debugging
        _raw: {
          ordersCount: orders.length,
          ordersData: orders.map(o => ({
            id: o._id,
            status: o.status,
            finalPrice: o.finalPrice,
            commission: o.commission
          }))
        }
      }
    });
    
  } catch (error) {
    console.error("❌ Error fetching client details for partner:", error);
    return res.status(500).json({
      success: false,
      error: "Error fetching client details",
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// ✅ NEW: Get all referred clients for a partner (for dashboard)
// ✅ FIXED: Get all referred clients for a partner (with proper order counting)
exports.getReferredClientsForPartner = async (req, res) => {
  try {
    const partnerId = req.partner._id;
    
    console.log('📊 Fetching referred clients for partner:', partnerId.toString());
    
    // Find all clients referred by this partner
    const clients = await Client.find({
      referredBy: partnerId
    })
    .select('name email source clientType status createdAt referredBy _id')
    .sort({ createdAt: -1 })
    .lean();
    
    console.log(`✅ Found ${clients.length} referred clients`);
    
    // Get ALL orders for this partner
    // IMPORTANT: Check how orders are linked to clients in your Order model
    const allPartnerOrders = await Order.find({
      $or: [
        { referredBy: partnerId },
        { 'referralInfo.referredBy': partnerId }
      ]
    })
    .select('client customerDetails status _id')
    .lean();
    
    console.log(`📦 Found ${allPartnerOrders.length} total orders for this partner`);
    
    // Create a map of client IDs for quick lookup
    const clientIdMap = {};
    clients.forEach(client => {
      clientIdMap[client._id.toString()] = client;
    });
    
    // Debug: Show what we found
    console.log('🔍 Orders found:', allPartnerOrders.map(order => ({
      orderId: order._id,
      client: order.client?.toString(),
      customerEmail: order.customerDetails?.email,
      status: order.status
    })));
    
    // Group orders by client ID AND by email (just in case)
    const ordersByClientId = {};
    const ordersByEmail = {};
    
    allPartnerOrders.forEach(order => {
      // Group by client ID
      if (order.client) {
        const clientId = order.client.toString();
        if (!ordersByClientId[clientId]) {
          ordersByClientId[clientId] = [];
        }
        ordersByClientId[clientId].push(order);
      }
      
      // Also group by email (in case client field is not set)
      if (order.customerDetails?.email) {
        const email = order.customerDetails.email.toLowerCase();
        if (!ordersByEmail[email]) {
          ordersByEmail[email] = [];
        }
        ordersByEmail[email].push(order);
      }
    });
    
    console.log('📊 Orders grouped by client ID:', Object.keys(ordersByClientId));
    console.log('📊 Orders grouped by email:', Object.keys(ordersByEmail));
    
    // Get orders for each client - try multiple matching strategies
    const clientsWithOrders = clients.map((client) => {
      const clientId = client._id.toString();
      const clientEmail = client.email.toLowerCase();
      
      let clientOrders = [];
      
      // Strategy 1: Match by client ID
      if (ordersByClientId[clientId]) {
        clientOrders = ordersByClientId[clientId];
        console.log(`✅ Client ${client.email}: Found ${clientOrders.length} orders by client ID`);
      }
      // Strategy 2: Match by email
      else if (ordersByEmail[clientEmail]) {
        clientOrders = ordersByEmail[clientEmail];
        console.log(`✅ Client ${client.email}: Found ${clientOrders.length} orders by email match`);
      }
      else {
        console.log(`❌ Client ${client.email}: No orders found by ID or email`);
      }
      
      return {
        ...client,
        orders: clientOrders,
        totalOrders: clientOrders.length,
        source: client.source || 'REFERRAL',
        clientType: client.clientType || 'REFERRAL'
      };
    });
    
    // Debug summary
    const clientsWithOrdersCount = clientsWithOrders.filter(c => c.totalOrders > 0).length;
    const totalOrdersCount = clientsWithOrders.reduce((sum, client) => sum + client.totalOrders, 0);
    
    console.log('📊 FINAL SUMMARY:');
    console.log(`- Total clients: ${clients.length}`);
    console.log(`- Clients with orders: ${clientsWithOrdersCount}`);
    console.log(`- Total orders across all clients: ${totalOrdersCount}`);
    
    clientsWithOrders.forEach((client, index) => {
      if (client.totalOrders > 0) {
        console.log(`${index + 1}. ${client.name} (${client.email}): ${client.totalOrders} orders`);
      }
    });
    
    res.status(200).json({
      success: true,
      data: clientsWithOrders,
      count: clientsWithOrders.length,
      debug: {
        totalClients: clients.length,
        totalOrdersFound: allPartnerOrders.length,
        clientsWithOrders: clientsWithOrdersCount,
        totalOrdersAssigned: totalOrdersCount
      }
    });
    
  } catch (error) {
    console.error("❌ Error fetching referred clients for partner:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch referred clients",
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};