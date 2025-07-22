
const Client = require('../model/Client');
const Partner = require('../model/Partner');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const Order = require('../model/Order')

const PRICING = {
  STARTER: 3900,
  TURNKEY: 4600,
  PREMIUM: 9800
};
const COMMISSION_RATE = 0.10;

// Helper function for error responses
const handleErrorResponse = (res, error, action) => {
  console.error(`Error while trying to ${action}:`, error);
  res.status(500).json({
    success: false,
    message: `Failed to ${action}`,
    error: process.env.NODE_ENV === 'development' ? error.message : undefined
  });
};




exports.createOrder = async (req, res) => {
  try {
    const { plan, customerDetails, referralCode, clientId } = req.body;

    // Validate required fields
    if (!plan || !customerDetails) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: plan and customerDetails'
      });
    }

    if (!PRICING[plan]) {
      return res.status(400).json({
        success: false,
        message: 'Invalid plan selected'
      });
    }

    // Initialize with DIRECT order defaults
    const orderData = {
      plan,
      customerDetails,
      originalPrice: PRICING[plan],
      finalPrice: PRICING[plan],
      status: 'pending',
      source: 'DIRECT',
      partnerCommission: 0,
      referredBy: null,
      referralCode: null,
      client: clientId || null
    };

    // ONLY process as referral if ALL conditions are met:
    // 1. Explicit referralCode is provided in the current request
    // 2. The code matches an active partner
    if (referralCode) {
      const partner = await Partner.findOne({
        referralCode: referralCode,
        status: 'active'
      });

      if (partner) {
        const commission = Math.floor(PRICING[plan] * COMMISSION_RATE);
        orderData.source = 'REFERRAL';
        orderData.referredBy = partner._id;
        orderData.referralCode = partner.referralCode;
        orderData.partnerCommission = commission;
        orderData.finalPrice = PRICING[plan] - commission;
        
        console.log('Referral applied from current order:', {
          partner: partner._id,
          commission: commission,
          finalPrice: orderData.finalPrice
        });
      }
    }

    // Final validation to ensure direct orders have no commission
    if (!orderData.referralCode) {
      orderData.source = 'DIRECT';
      orderData.partnerCommission = 0;
      orderData.referredBy = null;
      orderData.finalPrice = PRICING[plan];
    }

    console.log('Creating order with:', {
      plan: orderData.plan,
      source: orderData.source,
      finalPrice: orderData.finalPrice,
      commission: orderData.partnerCommission,
      hasReferral: orderData.referralCode !== null
    });

    // Create the order
    const order = await Order.create(orderData);

    // Stripe session creation
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'eur',
          product_data: {
            name: `${plan} Plan`,
            description: 'Company formation package'
          },
          unit_amount: orderData.finalPrice,
        },
        quantity: 1,
      }],
      mode: 'payment',
      success_url: `${process.env.FRONTEND_URL}/payment-success?session_id={CHECKOUT_SESSION_ID}&order_id=${order._id}`,
      cancel_url: `${process.env.FRONTEND_URL}/payment-cancelled`,
      metadata: {
        orderId: order._id.toString(),
        isReferral: orderData.source === 'REFERRAL'
      }
    });

    // Update order with session ID
    order.stripeSessionId = session.id;
    await order.save();

    res.json({
      success: true,
      url: session.url,
      orderId: order._id,
      isReferral: orderData.source === 'REFERRAL',
      finalPrice: orderData.finalPrice,
      commission: orderData.partnerCommission
    });

  } catch (error) {
    console.error('Order creation failed:', error);
    res.status(500).json({
      success: false,
      message: 'Order creation failed',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

exports.handleWebhook = async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  switch (event.type) {
    case 'checkout.session.completed':
      const session = event.data.object;
      await Order.findOneAndUpdate(
        { stripeSessionId: session.id },
        {
          status: 'completed',
          paymentIntentId: session.payment_intent,
          paymentConfirmedAt: new Date()
        }
      );
      break;

    case 'checkout.session.async_payment_failed':
      const failedSession = event.data.object;
      await Order.findOneAndUpdate(
        { stripeSessionId: failedSession.id },
        { status: 'failed' }
      );
      break;
  }

  res.json({ received: true });
};

// Handle successful payment webhook
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
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle payment events
  switch (event.type) {
    case 'checkout.session.completed':
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
        ).populate('client');

        // If this was a referral order, update partner stats
        if (order?.referredBy) {
          await Partner.findByIdAndUpdate(order.referredBy, {
            $inc: { 
              commissionEarned: order.partnerCommission,
              totalReferralSales: order.finalPrice
            },
            $addToSet: { 
              clientsReferred: order.client._id,
              ordersReferred: order._id 
            }
          });
        }
      } catch (err) {
        console.error('Error processing completed session:', err);
      }
      break;

    case 'checkout.session.async_payment_failed':
      const failedSession = event.data.object;
      await Order.findOneAndUpdate(
        { stripeSessionId: failedSession.id },
        { 
          status: 'failed',
          cancellationReason: 'payment_failed'
        }
      );
      break;
  }

  res.json({ received: true });
};


// Get all orders (admin)
exports.getAllOrders = async (req, res) => {
  try {
    const orders = await Order.find()
      .populate('client', 'name email')
      .populate('referredBy', 'name email referralCode')
      .sort({ createdAt: -1 });
      
    res.json({ 
      success: true, 
      count: orders.length, 
      data: orders 
    });
  } catch (error) {
    handleErrorResponse(res, error, 'fetch orders');
  }
};

// Get single order
// Get single order details
// Add this to your orderController.js
exports.getOrder = async (req, res) => {
  try {
    // Skip authentication for this endpoint since it's needed for payment verification
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

    // Basic security check - ensure the order is either completed or belongs to the requesting user
    // (You might want to add more specific checks based on your requirements)
    if (order.status !== 'completed') {
      return res.status(403).json({
        success: false,
        message: 'Order not yet completed'
      });
    }

    res.json({
      success: true,
      data: order
    });

  } catch (error) {
    console.error('Error fetching order:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch order details',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Cancel order
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

    // If order was completed and had commission, reverse it
    if (order.status === 'completed' && order.referredBy && order.partnerCommission > 0) {
      await Partner.findByIdAndUpdate(order.referredBy, {
        $inc: { commissionEarned: -order.partnerCommission }
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

    // Only return completed orders to public endpoint
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
        price: order.finalPrice || order.amount,
        status: order.status,
        createdAt: order.createdAt,
        customerDetails: order.customerDetails,
        paymentMethod: order.paymentMethod,
        paymentConfirmedAt: order.paymentConfirmedAt
      }
    });
  } catch (error) {
    console.error('Error fetching public order:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch order details'
    });
  }
};