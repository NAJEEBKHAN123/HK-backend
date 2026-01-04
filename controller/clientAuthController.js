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
exports.getAllClients = async (req, res) => {
  try {
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
    } else {
      query = {}; // Explicit empty query when no search term
    }
    
    const clients = await Client.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);
      
    const total = await Client.countDocuments(query);
    const pages = Math.ceil(total / limit);
    
    res.status(200).json({
      success: true,
      message: "All clients fetched successfully",
      data: clients,
      total,
      pages,
      page
    });
  } catch (error) {
    console.error("Error in fetching clients:", error);
    res.status(500).json({
      success: false,
      message: "Error in fetching clients",
      error: error.message // Include the actual error message
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
exports.getClientDetailsForPartner = async (req, res) => {
  try {
    const { id } = req.params;
    
    // First verify the client exists and was referred by this partner
    const client = await Client.findOne({
      _id: id,
      referredBy: req.partner._id
    }).populate('referredBy', 'name email');

    if (!client) {
      return res.status(404).json({
        success: false,
        error: "Client not found or not referred by you"
      });
    }

    // Find all orders for this client that were referred by this partner
    const orders = await Order.find({ 
      client: id,
      referredBy: req.partner._id
    })
    .select('-stripeSessionId -paymentIntentId -isCommissionProcessed -__v')
    .sort({ createdAt: -1 });
    
    // Calculate total spend (in cents)
    const totalSpend = orders.reduce((total, order) => {
      return total + (order.finalPrice || order.originalPrice || 0);
    }, 0);
    
    // Calculate total commission
    const totalCommission = orders.reduce((total, order) => {
      return total + (order.partnerCommission || 0);
    }, 0);
    
    // Calculate average order
    const averageOrder = orders.length > 0 ? totalSpend / orders.length : 0;

    return res.status(200).json({
      success: true,
      data: {
        ...client.toObject(),
        orders: orders,
        totalOrders: orders.length,
        totalSpend: totalSpend,
        totalCommission: totalCommission,
        averageOrder: averageOrder,
        totalSpendDisplay: `€${(totalSpend / 100).toFixed(2)}`,
        totalCommissionDisplay: `€${(totalCommission / 100).toFixed(2)}`,
        averageOrderDisplay: `€${(averageOrder / 100).toFixed(2)}`
      }
    });
  } catch (error) {
    console.error("Error fetching client details for partner:", error);
    return res.status(500).json({
      success: false,
      error: "Error fetching client details"
    });
  }
};