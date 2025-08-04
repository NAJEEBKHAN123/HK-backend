const Client = require('../model/Client');
const Partner = require('../model/Partner');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const Order = require('../model/Order');
const EmailService = require('../services/emailService'); // ADDED MISSING IMPORT
const { logError, logInfo } = require('../utils/logger'); // ADDED LOGGER UTILITY

const PRICING = {
  STARTER: 3900,
  TURNKEY: 4600,
  PREMIUM: 9800
};
const COMMISSION_RATE = 0.10; // 10%

// Enhanced error handler
const handleErrorResponse = (res, error, action, context = {}) => {
  const errorId = Math.random().toString(36).substring(2, 9);
  logError(`Error ${action}`, { 
    error: error.message, 
    stack: error.stack,
    errorId,
    ...context 
  });
  
  res.status(500).json({
    success: false,
    message: `Failed to ${action}`,
    errorId,
    error: process.env.NODE_ENV === 'development' ? error.message : undefined
  });
};

// Enhanced email sending with retries
const sendOrderEmailWithRetry = async (order, emailType, retries = 3) => {
  try {
    if (!order.customerDetails?.email) {
      throw new Error('Missing customer email');
    }

    logInfo(`Sending ${emailType} email for order ${order._id}`, {
      customerEmail: order.customerDetails.email
    });

    if (emailType === 'confirmation') {
      await EmailService.sendOrderConfirmation(order);
    } else if (emailType === 'payment') {
      await EmailService.sendPaymentSuccess(order);
    }

    logInfo(`Successfully sent ${emailType} email for order ${order._id}`);
  } catch (emailError) {
    if (retries > 0) {
      logError(`Retrying ${emailType} email (${retries} left) for order ${order._id}`, {
        error: emailError.message
      });
      await new Promise(resolve => setTimeout(resolve, 1000 * (4 - retries))); // Exponential backoff
      return sendOrderEmailWithRetry(order, emailType, retries - 1);
    }
    throw emailError;
  }
};

exports.createOrder = async (req, res) => {
  try {
    const { plan, customerDetails, referralCode, clientId } = req.body;

    // Validate input
    if (!plan || !customerDetails || !customerDetails.email) {
      return res.status(400).json({ 
        success: false,
        message: 'Missing required fields' 
      });
    }

    if (!PRICING[plan]) {
      return res.status(400).json({ 
        success: false,
        message: 'Invalid plan selected' 
      });
    }

    // Initialize order with full price
    const orderData = {
      plan,
      customerDetails,
      originalPrice: PRICING[plan],
      finalPrice: PRICING[plan],
      status: 'pending',
      source: 'DIRECT',
      client: clientId || null
    };

    let partner = null;

    // Process referral if code exists
    if (referralCode) {
      partner = await Partner.findOne({ 
        referralCode,
        status: 'active'
      });

      if (partner) {
        orderData.source = 'REFERRAL';
        orderData.referredBy = partner._id;
        orderData.referralCode = referralCode;
        orderData.partnerCommission = Math.floor(PRICING[plan] * COMMISSION_RATE);
        orderData.finalPrice = PRICING[plan] - orderData.partnerCommission;
      }
    }

    // Create the order
    const order = await Order.create(orderData);
    console.log('order is created', order)

    // Send order confirmation emails with enhanced logging
    try {
      await sendOrderEmailWithRetry(order, 'confirmation');
      logInfo('Order confirmation email processed', { orderId: order._id });
    } catch (emailError) {
      logError('Order confirmation email failed', {
        orderId: order._id,
        error: emailError.message,
        stack: emailError.stack
      });
      // Continue with order creation even if email fails
    }

    // Create Stripe checkout
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'eur',
          product_data: {
            name: `${plan} Plan`,
            description: 'Company formation package'
          },
          unit_amount: order.originalPrice,
        },
        quantity: 1,
      }],
      mode: 'payment',
      success_url: `${process.env.FRONTEND_URL}/payment-success?session_id={CHECKOUT_SESSION_ID}&order_id=${order._id}`,
      cancel_url: `${process.env.FRONTEND_URL}/payment-cancelled?order_id=${order._id}`,
      customer_email: order.customerDetails.email,
      metadata: {
        orderId: order._id.toString(),
        clientId: order.client?.toString() || '',
        referralCode: order.referralCode || ''
      }
    });

    order.stripeSessionId = session.id;
    await order.save();

    // Update partner stats if applicable
    if (partner && clientId) {
      await Partner.findByIdAndUpdate(
        partner._id,
        { $inc: { totalOrdersReferred: 1 } }
      );
    }

    res.json({
      success: true,
      url: session.url,
      orderId: order._id,
      amount: order.originalPrice,
      currency: 'eur'
    });

  } catch (error) {
    handleErrorResponse(res, error, 'create order', {
      plan: req.body.plan,
      customerEmail: req.body.customerDetails?.email
    });
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
    logError('Stripe webhook verification failed', { error: err.message });
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

      if (!order) {
        logError('Order not found for completed Stripe session', {
          sessionId: session.id
        });
        return res.json({ received: true });
      }

      // Send payment confirmation email
      try {
        await sendOrderEmailWithRetry(order, 'payment');
        logInfo('Payment confirmation email sent', { orderId: order._id });
      } catch (emailError) {
        logError('Payment confirmation email failed', {
          orderId: order._id,
          error: emailError.message
        });
      }

      // Process commission for referral orders
      if (order?.source === 'REFERRAL' && 
          order.referredBy && 
          !order.isCommissionProcessed) {
        
        await processCommission(order);
      }
    } catch (err) {
      logError('Webhook processing error', {
        eventId: event.id,
        error: err.message,
        stack: err.stack
      });
    }
  }

  res.json({ received: true });
};

// Get single order
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

    // Convert status to lowercase and validate
    const normalizedStatus = status.toLowerCase();
   if (!['pending', 'processing', 'completed', 'failed', 'cancelled'].includes(normalizedStatus)) {
  return res.status(400).json({
    success: false,
    message: 'Invalid status value'
  });
}


    // Validate input
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

    // Handle commission updates
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

    // Handle commission reversal for cancelled orders
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