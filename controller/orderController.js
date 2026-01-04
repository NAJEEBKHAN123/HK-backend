const Client = require('../model/Client');
const Partner = require('../model/Partner');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const Order = require('../model/Order');
const EmailService = require('../services/emailService');
const crypto = require('crypto');

// ========== PRICING IN EUROS ==========
const PRICING = {
  STARTER: 3900,   // €3,900
  SMART: 4600,     // €4,600
  PREMIUM: 9800    // €9,800
};
const COMMISSION_RATE = 0.10; // 10%

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
      body: req.body,
      referralCode: req.body.referralCode,
      email: req.body.customerDetails?.email
    });

    const { plan, customerDetails, referralCode, referralSource = 'DIRECT' } = req.body;

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
    let isNewClient = false;

    if (!client) {
      console.log('👤 Client not found, creating new client...');
      
      const tempPassword = crypto.randomBytes(8).toString('hex');
      
      client = await Client.create({
        name: customerDetails.fullName,
        email: clientEmail,
        password: tempPassword,
        phone: customerDetails.phone || '',
        source: 'DIRECT',
        orders: [],
        status: 'active'
      });
      
      isNewClient = true;
      console.log(`✅ New client created: ${client.email}`);
    } else {
      console.log(`✅ Existing client found: ${client.email}`);
    }

    // ================== 2. HANDLE REFERRAL CODE ==================
    if (referralCode && referralCode.trim()) {
      console.log(`🔍 Looking for partner with referral code: "${referralCode.trim()}"`);
      
      partner = await Partner.findOne({ 
        referralCode: referralCode.trim(),
        status: 'active'
      });

      if (partner) {
        console.log(`✅ Found partner: ${partner.name}`);
        
        if (!client.referredBy || client.referredBy.toString() !== partner._id.toString()) {
          console.log(`🔗 Linking client to partner...`);
          
          client.source = 'REFERRAL';
          client.referredBy = partner._id;
          client.referralCode = referralCode.trim();
          await client.save();
          
          console.log(`✅ Client updated with referral info`);
          
          const partnerDoc = await Partner.findById(partner._id);
          const isClientAlreadyInList = partnerDoc.clientsReferred.some(
            clientId => clientId.toString() === client._id.toString()
          );
          
          if (!isClientAlreadyInList) {
            await Partner.findByIdAndUpdate(partner._id, {
              $addToSet: { clientsReferred: client._id },
              $inc: { totalClientsReferred: 1 }
            });
            console.log(`✅ Client added to partner's clientsReferred list`);
          }
        }
      } else {
        console.log(`❌ No active partner found for referral code: "${referralCode.trim()}"`);
      }
    }

    // ================== 3. CHECK CLIENT STATUS ==================
    const existingOrders = await Order.find({ 
      'customerDetails.email': clientEmail 
    });
    
    const clientStatus = existingOrders.length > 0 ? 'RETURNING' : 'NEW';

    // ================== 4. CREATE ORDER DATA ==================
    const orderData = {
      plan,
      customerDetails: {
        ...customerDetails,
        idFrontImage: customerDetails.idFrontImage,
        idBackImage: customerDetails.idBackImage
      },
      originalPrice: PRICING[plan], // In euros: 3900 = €3,900
      finalPrice: PRICING[plan],
      status: 'pending',
      source: 'DIRECT',
      referralSource: referralSource,
      clientStatus: clientStatus,
      client: client._id,
      isNewClient: isNewClient
    };

    // Add referral info if partner exists
    if (partner) {
      orderData.source = 'REFERRAL';
      orderData.referredBy = partner._id;
      orderData.referralCode = referralCode.trim();
      orderData.referralPartnerName = partner.name;
      orderData.clientStatus = 'REFERRED';
      orderData.partnerCommission = PRICING[plan] * COMMISSION_RATE; // Calculate 10%
      orderData.finalPrice = PRICING[plan] - orderData.partnerCommission;
      
      console.log(`💰 Commission calculated: €${orderData.partnerCommission} for partner ${partner.name}`);
      console.log(`💰 ${PRICING[plan]} × 10% = €${orderData.partnerCommission}`);
    }

    // ================== 5. CREATE ORDER ==================
    const order = await Order.create(orderData);
    console.log(`✅ Order created: ${order._id}`);

    // ================== 6. UPDATE CLIENT WITH ORDER ==================
    await Client.findByIdAndUpdate(client._id, {
      $push: { orders: order._id }
    });

    // ================== 7. UPDATE PARTNER WITH ORDER ==================
    if (partner) {
      await Partner.findByIdAndUpdate(partner._id, {
        $addToSet: { ordersReferred: order._id },
        $inc: { 
          totalOrdersReferred: 1,
          totalReferralSales: order.originalPrice,
          commissionEarned: order.partnerCommission,
          availableCommission: order.partnerCommission
        }
      });
      console.log(`💰 Partner commission updated: +€${order.partnerCommission}`);
    }

    // ================== 8. SEND EMAILS ==================
    try {
      await EmailService.sendOrderConfirmation(order);
    } catch (emailError) {
      console.error('❌ Email sending failed:', emailError.message);
    }

    // ================== 9. CREATE STRIPE SESSION ==================
    const stripeAmountInCents = Math.round(order.originalPrice * 100);
    
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'eur',
          product_data: {
            name: `${plan} Plan`,
            description: 'Company formation package'
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
        referralCode: order.referralCode || '',
        referralSource: order.referralSource || 'DIRECT'
      }
    });

    order.stripeSessionId = session.id;
    await order.save();

    // ================== 10. RETURN RESPONSE ==================
    res.json({
      success: true,
      url: session.url,
      orderId: order._id,
      clientId: client._id,
      amount: order.originalPrice,
      currency: 'eur',
      clientStatus: order.clientStatus,
      referralStatus: order.source === 'REFERRAL' ? 'referred' : 'direct',
      partnerCommission: order.partnerCommission || 0,
      message: partner 
        ? `Client linked to partner ${partner.name}. Commission: €${order.partnerCommission}` 
        : `Client created successfully`
    });

  } catch (error) {
    console.error('❌ Order creation error:', error);
    handleErrorResponse(res, error, 'create order');
  }
};

exports.handleStripeWebhook = async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook verification failed:', err);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;

    try {
      const order = await Order.findOneAndUpdate(
        { stripeSessionId: session.id },
        {
          status: 'completed',
          paymentIntentId: session.payment_intent,
          paymentMethod: session.payment_method_types[0],
          paymentConfirmedAt: new Date()
        },
        { new: true }
      ).populate('referredBy');

      if (order) {
        console.log(`Order ${order._id} marked as completed`);
        
        try {
          await EmailService.sendPaymentSuccess(order);
        } catch (emailError) {
          console.error('Failed to send payment confirmation email:', emailError);
        }
      }

      if (order?.source === 'REFERRAL' && 
          order.referredBy && 
          !order.isCommissionProcessed) {
        
        if (order.partnerCommission === 0) {
          order.partnerCommission = order.originalPrice * COMMISSION_RATE;
          order.finalPrice = order.originalPrice - order.partnerCommission;
        }

        try {
          await Partner.findByIdAndUpdate(order.referredBy._id, {
            $inc: {
              commissionEarned: order.partnerCommission,
              totalReferralSales: order.originalPrice
            },
            $addToSet: {
              ordersReferred: order._id
            }
          });

          order.isCommissionProcessed = true;
          await order.save();
          
          console.log(`Commission processed for partner ${order.referredBy.name}: €${order.partnerCommission}`);
        } catch (transferErr) {
          console.error('Commission processing failed:', transferErr);
          order.isCommissionProcessed = true;
          await order.save();
        }
      }
    } catch (err) {
      console.error('Webhook processing error:', err);
    }
  }

  res.json({ received: true });
};

exports.getAllOrders = async (req, res) => {
  try {
    const { page = 1, limit = 10, search = '', clientType, source } = req.query;
    const skip = (page - 1) * limit;

    const query = {};
    
    if (search) {
      query.$or = [
        { 'customerDetails.fullName': { $regex: search, $options: 'i' } },
        { 'customerDetails.email': { $regex: search, $options: 'i' } },
        { plan: { $regex: search, $options: 'i' } },
        { status: { $regex: search, $options: 'i' } },
        { referralPartnerName: { $regex: search, $options: 'i' } }
      ];
    }
    
    if (clientType && clientType !== 'ALL') {
      if (clientType === 'REFERRED') {
        query.source = 'REFERRAL';
      } else {
        query.clientStatus = clientType;
      }
    }
    
    if (source && source !== 'ALL') {
      query.referralSource = source;
    }

    const orders = await Order.find(query)
      .populate('client', 'name email')
      .populate('referredBy', 'name email referralCode')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Order.countDocuments(query);

    res.json({
      success: true,
      count: orders.length,
      total,
      page: Number(page),
      pages: Math.ceil(total / limit),
      data: orders
    });
  } catch (error) {
    console.error('Error fetching orders:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch orders'
    });
  }
};

exports.getOrder = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .select('-__v -updatedAt')
      .populate('client', 'fullName email phone')
      .populate('referredBy', 'name email referralCode');
    
    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    res.json({
      success: true,
      data: order
    });

  } catch (error) {
    handleErrorResponse(res, error, 'fetch order');
  }
};

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
    );

    if (!order) {
      return res.status(404).json({ 
        success: false, 
        message: 'Order not found' 
      });
    }

    if (order.status === 'completed' && order.referredBy && order.partnerCommission > 0) {
      await Partner.findByIdAndUpdate(order.referredBy._id, {
        $inc: { 
          commissionEarned: -order.partnerCommission,
          totalReferralSales: -order.originalPrice
        },
        $pull: { ordersReferred: order._id }
      });
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

exports.getPublicOrder = async (req, res) => {
  try {
    const order = await Order.findById(req.params.orderId)
      .select('-__v -updatedAt -referredBy -partnerCommission -stripeSessionId -stripePaymentIntentId')
      .populate('client', 'name email phone');

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    if (order.status !== 'completed') {
      return res.status(403).json({
        success: false,
        message: 'Order not yet completed'
      });
    }

    res.json({
      success: true,
      data: {
        _id: order._id,
        plan: order.plan,
        price: order.originalPrice,
        status: order.status,
        createdAt: order.createdAt,
        customerDetails: order.customerDetails,
        paymentMethod: order.paymentMethod,
        paymentConfirmedAt: order.paymentConfirmedAt
      }
    });
  } catch (error) {
    handleErrorResponse(res, error, 'fetch public order');
  }
};

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

    if (normalizedStatus === 'completed' && (!paymentMethod || !transactionReference)) {
      return res.status(400).json({
        success: false,
        message: 'Payment method and transaction reference are required for completed orders'
      });
    }

    const updateData = {
      status: normalizedStatus,
      adminNotes,
      ...(normalizedStatus === 'completed' && {
        paymentMethod,
        transactionReference,
        paymentConfirmedAt: new Date()
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
    ).populate('referredBy');

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    if (order.status === 'completed' && order.referredBy && order.partnerCommission > 0 && !order.isCommissionProcessed) {
      await Partner.findByIdAndUpdate(order.referredBy._id, {
        $inc: { 
          commissionEarned: order.partnerCommission,
          availableCommission: order.partnerCommission,
          totalReferralSales: order.originalPrice
        },
        $addToSet: { ordersReferred: order._id }
      });
      order.isCommissionProcessed = true;
      await order.save();
    }

    if (order.status === 'cancelled' && order.referredBy && order.partnerCommission > 0 && order.isCommissionProcessed) {
      await Partner.findByIdAndUpdate(order.referredBy._id, {
        $inc: { 
          commissionEarned: -order.partnerCommission,
          availableCommission: -order.partnerCommission,
          totalReferralSales: -order.originalPrice
        },
        $pull: { ordersReferred: order._id }
      });
      order.isCommissionProcessed = false;
      await order.save();
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

exports.getOrderStats = async (req, res) => {
  try {
    const totalOrders = await Order.countDocuments();
    const completedOrders = await Order.countDocuments({ status: 'completed' });
    const referralOrders = await Order.countDocuments({ source: 'REFERRAL' });
    const totalRevenue = await Order.aggregate([
      { $match: { status: 'completed' } },
      { $group: { _id: null, total: { $sum: '$finalPrice' } } }
    ]);
    
    const clientTypeStats = await Order.aggregate([
      {
        $group: {
          _id: {
            $cond: [
              { $eq: ['$source', 'REFERRAL'] },
              'REFERRED',
              '$clientStatus'
            ]
          },
          count: { $sum: 1 }
        }
      }
    ]);

    res.json({
      success: true,
      data: {
        totalOrders,
        completedOrders,
        referralOrders,
        totalRevenue: totalRevenue[0]?.total || 0,
        clientTypeStats
      }
    });
  } catch (error) {
    handleErrorResponse(res, error, 'fetch order statistics');
  }
};