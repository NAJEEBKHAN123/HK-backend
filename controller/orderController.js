const Client = require('../model/Client');
const Partner = require('../model/Partner');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const Order = require('../model/Order');
const EmailService = require('../services/emailService');
const crypto = require('crypto');

// ========== PRICING IN EUROS (in cents) ==========
const PRICING = {
  STARTER: 390000,   // €3,900 in cents
  SMART: 460000,     // €4,600 in cents
  PREMIUM: 980000    // €9,800 in cents
};

// 🔥 FIXED COMMISSION AMOUNT
const FIXED_COMMISSION = 40000; // €400 in cents

const handleErrorResponse = (res, error, action) => {
  console.error(`Error while trying to ${action}:`, error);
  res.status(500).json({
    success: false,
    message: `Failed to ${action}`,
    error: process.env.NODE_ENV === 'development' ? error.message : undefined
  });
};

// ============ CREATE ORDER FUNCTION ============
exports.createOrder = async (req, res) => {
  try {
    console.log('🔍 Order creation started:', {
      plan: req.body.plan,
      email: req.body.customerDetails?.email,
      referralCode: req.body.referralCode
    });

    const { plan, customerDetails, referralCode } = req.body;

    // Validation
    if (!plan || !customerDetails || !customerDetails.email || !customerDetails.fullName) {
      return res.status(400).json({ 
        success: false,
        message: 'Missing required fields: plan, email, fullName' 
      });
    }

    if (!customerDetails.idFrontImage || !customerDetails.idBackImage) {
      return res.status(400).json({ 
        success: false,
        message: 'Both ID images are required' 
      });
    }

    if (!PRICING[plan]) {
      return res.status(400).json({ 
        success: false,
        message: 'Invalid plan selected' 
      });
    }

    // ================== 1. FIND OR CREATE CLIENT ==================
    const clientEmail = customerDetails.email.toLowerCase();
    let client = await Client.findOne({ email: clientEmail });
    let partner = null;
    let clientType = 'DIRECT';

    if (!client) {
      console.log('👤 Creating new client...');
      
      const tempPassword = crypto.randomBytes(8).toString('hex');
      
      client = await Client.create({
        name: customerDetails.fullName,
        email: clientEmail,
        password: tempPassword,
        phone: customerDetails.phone || '',
        clientType: 'DIRECT'
      });
      
      console.log(`✅ New client created: ${client.email}`);
    }

    // ================== 2. HANDLE REFERRAL CODE ==================
    if (referralCode && referralCode.trim()) {
      console.log(`🔍 Looking for partner with code: "${referralCode.trim()}"`);
      
      partner = await Partner.findOne({ 
        referralCode: referralCode.trim(),
        status: 'active'
      });

      if (partner) {
        console.log(`✅ Found partner: ${partner.name}`);
        clientType = 'REFERRAL';
        
        // Update client with referral info
        client.clientType = 'REFERRAL';
        client.referredBy = partner._id;
        client.referralCode = referralCode.trim();
        await client.save();
        
        console.log(`✅ Client marked as referral for partner ${partner.name}`);
      } else {
        console.log(`❌ No active partner found for code: "${referralCode.trim()}"`);
      }
    }

    // ================== 3. CREATE ORDER ==================
    const orderData = {
      plan,
      customerDetails: {
        ...customerDetails,
        email: clientEmail,
        idFrontImage: customerDetails.idFrontImage,
        idBackImage: customerDetails.idBackImage
      },
      originalPrice: PRICING[plan],
      finalPrice: PRICING[plan], // Client pays full price
      status: 'pending',
      clientType: clientType,
      client: client._id,
      stripe: {
        paymentStatus: 'pending',
        currency: 'eur',
        amountPaid: PRICING[plan]
      }
    };

    // Add referral info if partner exists
    if (partner && clientType === 'REFERRAL') {
      orderData.referralInfo = {
        referralCode: referralCode.trim(),
        referredBy: partner._id,
        partnerName: partner.name,
        partnerEmail: partner.email,
        partnerStripeAccountId: partner.stripeConnect?.accountId || null
      };
      
      // Set commission amount to €400
      orderData.commission = {
        amount: FIXED_COMMISSION,
        status: 'pending'
      };
      
      console.log(`💰 €400 commission will be paid to partner ${partner.name}`);
    }

    // ================== 4. CREATE ORDER ==================
    const order = await Order.create(orderData);
    console.log(`✅ Order created: ${order._id}, Type: ${clientType}, Price: €${PRICING[plan]/100}`);

    // ================== 5. UPDATE CLIENT WITH ORDER ==================
    await Client.findByIdAndUpdate(client._id, {
      $push: { orders: order._id }
    });

    // ================== 6. CREATE STRIPE SESSION ==================
    const stripeAmountInCents = order.finalPrice;
    
    const sessionConfig = {
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'eur',
          product_data: {
            name: `${plan} Plan - Company Formation`,
            description: 'Complete company formation package in Hong Kong',
            images: ['https://ouvrir-societe-hong-kong.fr/logo.png']
          },
          unit_amount: stripeAmountInCents,
        },
        quantity: 1,
      }],
      mode: 'payment',
      success_url: `${process.env.FRONTEND_URL}/payment-success?session_id={CHECKOUT_SESSION_ID}&order_id=${order._id}`,
      cancel_url: `${process.env.FRONTEND_URL}/payment-cancelled?order_id=${order._id}`,
      customer_email: order.customerDetails.email,
      metadata: {
        orderId: order._id.toString(),
        clientId: client._id.toString(),
        clientType: clientType,
        referralCode: order.referralInfo?.referralCode || '',
        partnerId: partner?._id?.toString() || '',
        commissionAmount: clientType === 'REFERRAL' ? '40000' : '0',
        plan: plan,
        amount: stripeAmountInCents.toString()
      }
    };

    // 🔥 STRIPE CONNECT: Automatic commission split for referrals
    if (clientType === 'REFERRAL' && partner?.stripeConnect?.accountId && partner.stripeConnect.chargesEnabled) {
      // Platform fee = total amount - €400 commission
      const platformFee = stripeAmountInCents - FIXED_COMMISSION;
      
      if (platformFee > 0) {
        sessionConfig.payment_intent_data = {
          application_fee_amount: platformFee,
          transfer_data: {
            destination: partner.stripeConnect.accountId,
          },
        };
        
        console.log(`🔥 Stripe Connect enabled: Partner gets €400, Platform keeps €${platformFee/100}`);
      } else {
        console.log('⚠️ Platform fee would be negative, not using Stripe Connect');
      }
    }

    const session = await stripe.checkout.sessions.create(sessionConfig);

    order.stripe.sessionId = session.id;
    await order.save();

    // ================== 7. RETURN RESPONSE ==================
    const response = {
      success: true,
      url: session.url,
      orderId: order._id,
      clientId: client._id,
      amount: order.finalPrice / 100,
      currency: 'eur',
      clientType: clientType,
      stripeSessionId: session.id
    };

    if (clientType === 'REFERRAL') {
      response.commission = {
        amount: 400,
        partnerName: partner.name,
        partnerEarnings: 400,
        platformEarnings: (order.finalPrice - FIXED_COMMISSION) / 100
      };
    }

    // ================== 8. AUTO-COMPLETE FOR DEVELOPMENT ==================
    if (process.env.NODE_ENV === 'development' || process.env.AUTO_COMPLETE === 'true') {
      console.log(`⏳ Auto-complete enabled. Will complete order ${order._id} in 2 seconds...`);
      
      setTimeout(async () => {
        try {
          const result = await exports.autoCompleteOrder(order._id);
          console.log(`Auto-complete result:`, result);
        } catch (error) {
          console.error('Auto-complete timeout error:', error);
        }
      }, 2000);
    }

    console.log(`✅ Order creation complete. Stripe URL: ${session.url}`);
    
    res.json(response);

  } catch (error) {
    console.error('❌ Order creation error:', error);
    handleErrorResponse(res, error, 'create order');
  }
};

// ========== AUTO-COMPLETE ORDER FUNCTION ==========
exports.autoCompleteOrder = async (orderId) => {
  try {
    console.log(`🔄 Auto-completing order: ${orderId}`);
    
    const order = await Order.findById(orderId)
      .populate('client')
      .populate('referralInfo.referredBy');

    if (!order) {
      console.error(`❌ Order ${orderId} not found`);
      return { success: false, message: 'Order not found' };
    }
    
    if (order.status === 'completed') {
      console.log(`✅ Order ${orderId} already completed`);
      return { success: true, message: 'Order already completed' };
    }
    
    // Update order status
    order.status = 'completed';
    order.stripe.paymentStatus = 'succeeded';
    order.paymentConfirmedAt = new Date();
    order.stripe.paymentMethod = 'card';
    order.transactionReference = order.stripe.sessionId || `auto_${Date.now()}`;
    
    // If it's a referral order and commission is pending
    if (order.clientType === 'REFERRAL' && order.commission.status === 'pending') {
      order.commission.status = 'approved';
      
      // Update partner's commission
      if (order.referralInfo.referredBy) {
        const partner = await Partner.findById(order.referralInfo.referredBy);
        if (partner) {
          await partner.addCommission(order._id, order.finalPrice);
          console.log(`✅ €400 commission added to partner ${partner.email}`);
          
          // Update partner referrals
          await Partner.findByIdAndUpdate(partner._id, {
            $inc: {
              'referrals.totalClients': 1,
              'referrals.totalSales': order.finalPrice
            },
            $addToSet: {
              'referrals.clients': order.client,
              'referrals.orders': order._id
            }
          });
        }
      }
    }
    
    await order.save();
    console.log(`✅ Order ${orderId} marked as completed`);
    
    // Send email
    try {
      await EmailService.sendPaymentSuccess(order);
      console.log(`📧 Confirmation email sent for ${orderId}`);
    } catch (emailError) {
      console.error('Email error:', emailError);
    }
    
    return { 
      success: true, 
      message: `Order ${orderId} completed successfully`,
      order: {
        id: order._id,
        status: order.status,
        email: order.customerDetails?.email,
        clientType: order.clientType,
        commission: order.commission.amount > 0 ? `€${order.commission.amount/100}` : '€0'
      }
    };
    
  } catch (error) {
    console.error(`❌ Auto-complete failed for ${orderId}:`, error);
    return { 
      success: false, 
      message: error.message,
      error: error.toString()
    };
  }
};

// ========== WEBHOOK HANDLER ==========
exports.handleStripeWebhook = async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;
  
  console.log('🔄 Webhook received at:', new Date().toISOString());
  
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
    
    console.log(`✅ Webhook verified: ${event.type}`);
    
  } catch (err) {
    console.error('❌ Webhook verification failed:', err.message);
    
    // Try fallback secret
    if (process.env.STRIPE_WEBHOOK_SECRET_FALLBACK) {
      try {
        event = stripe.webhooks.constructEvent(
          req.body,
          sig,
          process.env.STRIPE_WEBHOOK_SECRET_FALLBACK
        );
        console.log('✅ Webhook verified with fallback secret');
      } catch (fallbackErr) {
        console.error('❌ Fallback also failed:', fallbackErr.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
      }
    } else {
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }
  }

  console.log(`📋 Event type: ${event.type}, Event ID: ${event.id}`);
  
  try {
    switch (event.type) {
      case 'checkout.session.completed':
        console.log('🎯 Processing checkout.session.completed');
        await handleCompletedSession(event.data.object);
        break;
        
      case 'payment_intent.succeeded':
        console.log('💰 Payment intent succeeded');
        await handleSuccessfulPayment(event.data.object);
        break;
        
      case 'transfer.created':
        console.log('💸 Transfer created (Stripe Connect)');
        await handleTransferCreated(event.data.object);
        break;
        
      default:
        console.log(`🤔 Unhandled event type: ${event.type}`);
    }
  } catch (error) {
    console.error('❌ Webhook processing error:', error);
  }

  res.json({ received: true, processed: true, timestamp: new Date().toISOString() });
};

async function handleCompletedSession(session) {
  try {
    console.log(`🔍 Looking for order with session: ${session.id}`);
    
    const order = await Order.findOne({ 'stripe.sessionId': session.id })
      .populate('client')
      .populate('referralInfo.referredBy');

    if (!order) {
      console.error(`❌ Order not found for session: ${session.id}`);
      return;
    }

    console.log(`✅ Found order: ${order._id}, Client type: ${order.clientType}`);
    
    order.status = 'completed';
    order.stripe.paymentIntentId = session.payment_intent;
    order.stripe.paymentStatus = 'succeeded';
    order.paymentConfirmedAt = new Date();
    order.stripe.paymentMethod = session.payment_method_types?.[0] || 'card';
    order.stripe.customerId = session.customer;
    order.stripe.receiptUrl = session.invoice || null;

    // If it's a referral order and commission is pending
    if (order.clientType === 'REFERRAL' && order.commission.status === 'pending') {
      order.commission.status = 'approved';
      
      // Update partner's commission
      if (order.referralInfo.referredBy) {
        const partner = await Partner.findById(order.referralInfo.referredBy);
        if (partner) {
          await partner.addCommission(order._id, order.finalPrice);
          console.log(`✅ €400 commission added to partner ${partner.email}`);
          
          // Update partner referrals
          await Partner.findByIdAndUpdate(partner._id, {
            $inc: {
              'referrals.totalClients': 1,
              'referrals.totalSales': order.finalPrice,
              'referrals.totalOrders': 1
            },
            $addToSet: {
              'referrals.clients': order.client,
              'referrals.orders': order._id
            }
          });
        }
      }
    }

    await order.save();
    
    // Send confirmation email
    try {
      await EmailService.sendPaymentSuccess(order);
      console.log(`📧 Email sent for order ${order._id}`);
    } catch (emailError) {
      console.error('Failed to send email:', emailError);
    }
    
    console.log(`✅ Order ${order._id} completed via webhook`);
    
  } catch (error) {
    console.error('❌ Error handling completed session:', error);
  }
}

async function handleSuccessfulPayment(paymentIntent) {
  try {
    const order = await Order.findOne({ 'stripe.paymentIntentId': paymentIntent.id });
    if (order) {
      order.stripe.paymentStatus = 'succeeded';
      await order.save();
      console.log(`✅ Payment intent updated for order ${order._id}`);
    }
  } catch (error) {
    console.error('Error handling payment intent:', error);
  }
}

async function handleTransferCreated(transfer) {
  try {
    // Find order by metadata
    const order = await Order.findOne({
      $or: [
        { 'commission.stripeTransferId': transfer.id },
        { 'referralInfo.partnerStripeAccountId': transfer.destination }
      ]
    });

    if (order && order.clientType === 'REFERRAL') {
      order.commission.stripeTransferId = transfer.id;
      order.commission.status = 'paid';
      order.commission.paidAt = new Date();
      order.commission.paymentMethod = 'stripe_connect';
      
      await order.save();
      console.log(`✅ Transfer recorded for order ${order._id}: €${transfer.amount/100}`);
    }
  } catch (error) {
    console.error('❌ Error handling transfer:', error);
  }
}

// ========== GET PUBLIC ORDER DETAILS ==========
exports.getPublicOrder = async (req, res) => {
  try {
    console.log(`🔍 Fetching public order: ${req.params.orderId}`);
    
    const order = await Order.findById(req.params.orderId)
      .select('-__v -updatedAt -stripe.sessionId -stripe.paymentIntentId -commission.stripeTransferId')
      .populate('client', 'name email');

    if (!order) {
      console.log(`❌ Order not found: ${req.params.orderId}`);
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    console.log(`✅ Order found: ${order._id}, Status: ${order.status}`);

    // Only block failed or cancelled orders
    if (order.status === 'failed' || order.status === 'cancelled') {
      console.log(`⛔ Order ${order._id} is ${order.status} - blocking access`);
      return res.status(403).json({
        success: false,
        message: `Order is ${order.status}. Please contact support.`
      });
    }

    // Calculate earnings breakdown
    const platformEarnings = order.clientType === 'DIRECT' 
      ? order.finalPrice 
      : Math.max(0, order.finalPrice - FIXED_COMMISSION);
    
    const partnerEarnings = order.clientType === 'REFERRAL' ? FIXED_COMMISSION : 0;

    const publicOrder = {
      _id: order._id,
      plan: order.plan,
      originalPrice: order.originalPrice / 100,
      finalPrice: order.finalPrice / 100,
      status: order.status,
      clientType: order.clientType,
      createdAt: order.createdAt,
      paymentConfirmedAt: order.paymentConfirmedAt,
      customerDetails: {
        fullName: order.customerDetails.fullName,
        email: order.customerDetails.email,
        phone: order.customerDetails.phone
      },
      commission: {
        amount: order.commission.amount / 100,
        status: order.commission.status,
        display: order.clientType === 'REFERRAL' ? '€400' : '€0'
      },
      earnings: {
        platform: platformEarnings / 100,
        partner: partnerEarnings / 100,
        clientPaid: order.finalPrice / 100
      },
      stripe: {
        paymentStatus: order.stripe.paymentStatus || 'pending',
        currency: order.stripe.currency,
        paymentMethod: order.stripe.paymentMethod
      }
    };

    console.log(`📦 Sending public order data for: ${order._id}`);
    
    res.json({
      success: true,
      data: publicOrder
    });

  } catch (error) {
    console.error(`❌ Error fetching public order ${req.params.orderId}:`, error);
    
    if (error.kind === 'ObjectId') {
      return res.status(400).json({
        success: false,
        message: 'Invalid order ID format'
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Failed to fetch order details',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// ========== GET ORDER BY SESSION ID ==========
exports.getOrderBySession = async (req, res) => {
  try {
    console.log(`🔍 Looking for order by session: ${req.params.sessionId}`);
    
    const order = await Order.findOne({ 
      'stripe.sessionId': req.params.sessionId 
    })
    .select('-__v -updatedAt -stripe.sessionId -stripe.paymentIntentId')
    .populate('client', 'name email')
    .lean();

    if (!order) {
      console.log(`❌ No order found for session: ${req.params.sessionId}`);
      return res.status(404).json({
        success: false,
        message: 'Order not found for this session'
      });
    }

    console.log(`✅ Found order ${order._id} for session ${req.params.sessionId}`);
    
    const publicOrder = {
      _id: order._id,
      plan: order.plan,
      originalPrice: order.originalPrice / 100,
      finalPrice: order.finalPrice / 100,
      status: order.status,
      clientType: order.clientType,
      createdAt: order.createdAt,
      customerDetails: order.customerDetails,
      commission: {
        amount: order.commission.amount / 100,
        status: order.commission.status
      },
      stripe: {
        paymentStatus: order.stripe.paymentStatus || 'pending',
        paymentMethod: order.stripe.paymentMethod
      }
    };

    res.json({
      success: true,
      data: publicOrder
    });
  } catch (error) {
    console.error('Session lookup error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch order',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// ========== GET ALL ORDERS (ADMIN) ==========
exports.getAllOrders = async (req, res) => {
  try {
    const { page = 1, limit = 10, search = '', clientType, status } = req.query;
    const skip = (page - 1) * limit;

    const query = {};
    
    if (search) {
      query.$or = [
        { 'customerDetails.fullName': { $regex: search, $options: 'i' } },
        { 'customerDetails.email': { $regex: search, $options: 'i' } },
        { plan: { $regex: search, $options: 'i' } },
        { 'referralInfo.partnerName': { $regex: search, $options: 'i' } }
      ];
    }
    
    if (clientType && clientType !== 'ALL') {
      query.clientType = clientType;
    }
    
    if (status && status !== 'ALL') {
      query.status = status;
    }

    const orders = await Order.find(query)
      .populate('client', 'name email')
      .populate('referralInfo.referredBy', 'name email referralCode')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Order.countDocuments(query);

    // Format amounts for display
    const formattedOrders = orders.map(order => ({
      ...order.toObject(),
      originalPriceEuros: order.originalPrice / 100,
      finalPriceEuros: order.finalPrice / 100,
      commissionEuros: order.commission.amount / 100,
      platformEarnings: order.clientType === 'DIRECT' 
        ? order.finalPrice / 100 
        : (order.finalPrice - FIXED_COMMISSION) / 100,
      partnerEarnings: order.clientType === 'REFERRAL' ? 400 : 0
    }));

    res.json({
      success: true,
      count: orders.length,
      total,
      page: Number(page),
      pages: Math.ceil(total / limit),
      data: formattedOrders
    });
  } catch (error) {
    console.error('Error fetching orders:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch orders',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// ========== GET SINGLE ORDER (ADMIN) ==========
exports.getOrder = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate('client', 'name email phone clientType')
      .populate('referralInfo.referredBy', 'name email referralCode phone');
    
    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    // Calculate earnings breakdown
    const earningsBreakdown = {
      clientPaid: order.finalPrice / 100,
      commission: order.commission.amount / 100,
      platformEarnings: order.clientType === 'DIRECT' 
        ? order.finalPrice / 100 
        : (order.finalPrice - FIXED_COMMISSION) / 100,
      partnerEarnings: order.clientType === 'REFERRAL' ? 400 : 0
    };

    const orderWithEarnings = {
      ...order.toObject(),
      originalPriceEuros: order.originalPrice / 100,
      finalPriceEuros: order.finalPrice / 100,
      commissionEuros: order.commission.amount / 100,
      earningsBreakdown
    };

    res.json({
      success: true,
      data: orderWithEarnings
    });

  } catch (error) {
    handleErrorResponse(res, error, 'fetch order');
  }
};

// ========== CANCEL ORDER ==========
exports.cancelOrder = async (req, res) => {
  try {
    const order = await Order.findByIdAndUpdate(
      req.params.id,
      {
        status: 'cancelled',
        cancellationReason: req.body.reason || 'user_cancelled',
        cancelledAt: new Date()
      },
      { new: true }
    ).populate('referralInfo.referredBy');

    if (!order) {
      return res.status(404).json({ 
        success: false, 
        message: 'Order not found' 
      });
    }

    // If it's a referral order with commission, reverse it
    if (order.status === 'cancelled' && order.clientType === 'REFERRAL' && order.commission.amount > 0) {
      const partner = await Partner.findById(order.referralInfo.referredBy);
      if (partner) {
        // Reverse the commission
        partner.commission.earned -= order.commission.amount;
        partner.commission.available -= order.commission.amount;
        await partner.save();
        
        console.log(`↩️ Reversed €400 commission for cancelled order ${order._id}`);
      }
    }

    res.json({ 
      success: true,
      data: order,
      message: 'Order cancelled successfully'
    });

  } catch (error) {
    handleErrorResponse(res, error, 'cancel order');
  }
};

// ========== UPDATE ORDER (ADMIN) ==========
exports.updateOrder = async (req, res) => {
  try {
    const { status, paymentMethod, transactionReference, adminNotes } = req.body;
    const orderId = req.params.id;

    const normalizedStatus = status.toLowerCase();
    if (!['pending', 'processing', 'completed', 'failed', 'cancelled'].includes(normalizedStatus)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status value'
      });
    }

    const updateData = {
      status: normalizedStatus,
      adminNotes,
      ...(normalizedStatus === 'completed' && {
        paymentMethod,
        transactionReference,
        paymentConfirmedAt: new Date(),
        'stripe.paymentStatus': 'succeeded'
      }),
      ...(normalizedStatus === 'cancelled' && {
        cancellationReason: req.body.cancellationReason || 'admin_cancelled',
        cancelledAt: new Date()
      })
    };

    const order = await Order.findByIdAndUpdate(
      orderId,
      updateData,
      { new: true }
    ).populate('referralInfo.referredBy');

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    // If order is completed and it's a referral with pending commission
    if (order.status === 'completed' && 
        order.clientType === 'REFERRAL' && 
        order.commission.status === 'pending' && 
        order.referralInfo.referredBy) {
      
      order.commission.status = 'approved';
      await order.save();
      
      const partner = await Partner.findById(order.referralInfo.referredBy);
      if (partner) {
        await partner.addCommission(order._id, order.finalPrice);
        console.log(`✅ €400 commission added for manually completed order ${order._id}`);
      }
    }

    // If order is cancelled and commission was paid
    if (order.status === 'cancelled' && 
        order.clientType === 'REFERRAL' && 
        order.commission.amount > 0 && 
        order.referralInfo.referredBy) {
      
      const partner = await Partner.findById(order.referralInfo.referredBy);
      if (partner) {
        // Reverse the commission
        partner.commission.earned -= order.commission.amount;
        partner.commission.available -= order.commission.amount;
        await partner.save();
        
        order.commission.status = 'cancelled';
        await order.save();
        
        console.log(`↩️ Reversed €400 commission for cancelled order ${order._id}`);
      }
    }

    res.json({
      success: true,
      data: order,
      message: 'Order updated successfully'
    });

  } catch (error) {
    console.error('Update order error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update order',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// ========== GET ORDER STATISTICS ==========
exports.getOrderStats = async (req, res) => {
  try {
    const totalOrders = await Order.countDocuments();
    const completedOrders = await Order.countDocuments({ status: 'completed' });
    const referralOrders = await Order.countDocuments({ clientType: 'REFERRAL' });
    const directOrders = await Order.countDocuments({ clientType: 'DIRECT' });
    
    // Total revenue
    const totalRevenueResult = await Order.aggregate([
      { $match: { status: 'completed' } },
      { $group: { _id: null, total: { $sum: '$finalPrice' } } }
    ]);
    
    // Commission paid
    const totalCommissionResult = await Order.aggregate([
      { $match: { status: 'completed', clientType: 'REFERRAL' } },
      { $group: { _id: null, total: { $sum: '$commission.amount' } } }
    ]);
    
    // Platform earnings (total - commission)
    const platformEarningsResult = await Order.aggregate([
      { $match: { status: 'completed' } },
      { 
        $group: { 
          _id: null, 
          total: { 
            $sum: {
              $cond: [
                { $eq: ['$clientType', 'REFERRAL'] },
                { $subtract: ['$finalPrice', '$commission.amount'] },
                '$finalPrice'
              ]
            }
          }
        } 
      }
    ]);
    
    // Monthly stats
    const now = new Date();
    const last30Days = new Date(now.setDate(now.getDate() - 30));
    
    const monthlyStats = await Order.aggregate([
      {
        $match: {
          status: 'completed',
          createdAt: { $gte: last30Days }
        }
      },
      {
        $group: {
          _id: {
            $dateToString: { format: "%Y-%m", date: "$createdAt" }
          },
          totalOrders: { $sum: 1 },
          totalRevenue: { $sum: "$finalPrice" },
          referralOrders: {
            $sum: { $cond: [{ $eq: ["$clientType", "REFERRAL"] }, 1, 0] }
          },
          totalCommission: {
            $sum: "$commission.amount"
          }
        }
      },
      { $sort: { _id: -1 } }
    ]);

    const totalRevenue = totalRevenueResult[0]?.total || 0;
    const totalCommission = totalCommissionResult[0]?.total || 0;
    const platformEarnings = platformEarningsResult[0]?.total || 0;

    res.json({
      success: true,
      data: {
        totalOrders,
        completedOrders,
        referralOrders,
        directOrders,
        conversionRate: totalOrders > 0 ? ((completedOrders / totalOrders) * 100).toFixed(2) + '%' : '0%',
        financials: {
          totalRevenue: totalRevenue / 100,
          totalCommission: totalCommission / 100,
          platformEarnings: platformEarnings / 100,
          netRevenue: (totalRevenue - totalCommission) / 100
        },
        clientTypeStats: [
          { type: 'DIRECT', count: directOrders },
          { type: 'REFERRAL', count: referralOrders }
        ],
        monthlyStats: monthlyStats.map(stat => ({
          ...stat,
          totalRevenue: stat.totalRevenue / 100,
          totalCommission: stat.totalCommission / 100
        }))
      }
    });
  } catch (error) {
    handleErrorResponse(res, error, 'fetch order statistics');
  }
};

// ========== GET ORDER BREAKDOWN ==========
exports.getOrderBreakdown = async (req, res) => {
  try {
    const order = await Order.findById(req.params.orderId);
    
    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }
    
    const platformEarnings = order.clientType === 'DIRECT' 
      ? order.finalPrice 
      : Math.max(0, order.finalPrice - FIXED_COMMISSION);
    
    const partnerEarnings = order.clientType === 'REFERRAL' ? FIXED_COMMISSION : 0;
    
    res.json({
      success: true,
      data: {
        orderId: order._id,
        clientType: order.clientType,
        plan: order.plan,
        clientPaid: order.finalPrice / 100,
        breakdown: {
          platformEarnings: platformEarnings / 100,
          partnerEarnings: partnerEarnings / 100,
          commission: order.commission.amount / 100,
          percentage: order.clientType === 'REFERRAL' 
            ? `${((FIXED_COMMISSION / order.finalPrice) * 100).toFixed(2)}%` 
            : '0%'
        }
      }
    });
    
  } catch (error) {
    handleErrorResponse(res, error, 'get order breakdown');
  }
};

// ========== BATCH PROCESS COMMISSIONS ==========
exports.batchProcessCommissions = async (req, res) => {
  try {
    const { startDate, endDate } = req.body;
    
    const query = {
      status: 'completed',
      clientType: 'REFERRAL',
      'commission.status': 'pending'
    };
    
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }
    
    const pendingOrders = await Order.find(query)
      .populate('referralInfo.referredBy');
    
    console.log(`🔍 Found ${pendingOrders.length} orders with pending commission`);
    
    const results = [];
    let totalCommission = 0;
    
    for (const order of pendingOrders) {
      try {
        if (order.referralInfo.referredBy) {
          const partner = order.referralInfo.referredBy;
          
          // Update order commission status
          order.commission.status = 'approved';
          await order.save();
          
          // Add commission to partner
          partner.commission.earned += order.commission.amount;
          partner.commission.available += order.commission.amount;
          partner.referrals.totalOrders += 1;
          partner.referrals.totalSales += order.finalPrice;
          
          if (!partner.referrals.clients.includes(order.client)) {
            partner.referrals.clients.push(order.client);
            partner.referrals.totalClients += 1;
          }
          
          partner.referrals.orders.push(order._id);
          await partner.save();
          
          totalCommission += order.commission.amount;
          
          results.push({
            orderId: order._id,
            partnerId: partner._id,
            partnerEmail: partner.email,
            amount: order.commission.amount / 100,
            status: 'success'
          });
          
          console.log(`✅ Processed €400 commission for order ${order._id}`);
        }
      } catch (error) {
        console.error(`❌ Failed to process order ${order._id}:`, error);
        results.push({
          orderId: order._id,
          status: 'failed',
          error: error.message
        });
      }
    }
    
    res.json({
      success: true,
      message: `Processed ${results.filter(r => r.status === 'success').length} commissions`,
      totalCommission: totalCommission / 100,
      results
    });
    
  } catch (error) {
    console.error('Batch process error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to batch process commissions',
      error: error.message
    });
  }
};

// ========== HEALTH CHECK ==========
exports.healthCheck = async (req, res) => {
  try {
    const totalOrders = await Order.countDocuments();
    const pendingOrders = await Order.countDocuments({ status: 'pending' });
    const pendingCommissions = await Order.countDocuments({ 
      clientType: 'REFERRAL', 
      'commission.status': 'pending',
      status: 'completed'
    });
    
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      stats: {
        totalOrders,
        pendingOrders,
        pendingCommissions,
        commissionRate: '€400 per referral order'
      },
      pricing: {
        STARTER: '€3,900',
        SMART: '€4,600',
        PREMIUM: '€9,800'
      },
      commissionSystem: {
        directClient: 'Platform gets 100%',
        referralClient: 'Partner gets €400, Platform gets (price - €400)'
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};