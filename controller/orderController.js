const Order = require('../model/Order');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);


const handleErrorResponse = (res, error, context) => {
  console.error(`Error in ${context}:`, error);
  res.status(500).json({
    success: false,
    message: `Failed to ${context}`,
    error: process.env.NODE_ENV === 'development' ? error.message : undefined
  });
};

// Create Order with Stripe Session
exports.createOrder = async (req, res) => {
  try {
    const { fullName, email, phone, birthday, address, plan, price, idImage } = req.body;

    // Validate required fields
    const requiredFields = { fullName, email, phone, birthday, address, plan, price, idImage };
    for (const [field, value] of Object.entries(requiredFields)) {
      if (!value) return res.status(400).json({ success: false, message: `${field} is required` });
    }

    // Create order
    const order = await Order.create({
      fullName,
      email,
      phone,
      birthday: new Date(birthday),
      address,
      plan: plan.toUpperCase(),
      price,
      idImage,
      status: 'pending'
    });

    // Create Stripe session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'eur',
          product_data: { name: `${plan} Package` },
          unit_amount: price,
        },
        quantity: 1,
      }],
      mode: 'payment',
      success_url: `${process.env.FRONTEND_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL}/payment-cancelled?order_id=${order._id}`,
      metadata: { orderId: order._id.toString() }
    });

    // Link Stripe session to order
    order.stripeSessionId = session.id;
    await order.save();

    res.json({ 
      success: true,
      url: session.url,
      orderId: order._id
    });

  } catch (error) {
    handleErrorResponse(res, error, 'create order');
  }
};

// Handle Payment Cancellation
exports.handlePaymentCancel = async (req, res) => {
  try {
    const { order_id } = req.query;
    const { reason } = req.body;

    const order = await Order.findByIdAndUpdate(
      order_id,
      {
        status: 'cancelled',
        cancellationReason: reason || 'user_cancelled',
        cancelledAt: new Date()
      },
      { new: true, runValidators: true }
    );

    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
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

// Stripe Webhook Handler
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
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle payment failure
  if (event.type === 'checkout.session.async_payment_failed') {
    const session = event.data.object;
    await Order.findOneAndUpdate(
      { stripeSessionId: session.id },
      {
        status: 'failed',
        cancellationReason: 'payment_failed',
        failedAt: new Date()
      }
    );
  }

  // Handle successful payment
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    await Order.findOneAndUpdate(
      { stripeSessionId: session.id },
      {
        status: 'completed',
        paymentIntentId: session.payment_intent,
        paymentConfirmedAt: new Date()
      }
    );
  }

  res.json({ received: true });
};

// Get All Orders
exports.getAllOrders = async (req, res) => {
  try {
    const orders = await Order.find().sort({ createdAt: -1 });
    res.json({ success: true, count: orders.length, data: orders });
  } catch (error) {
    handleErrorResponse(res, error, 'fetch orders');
  }
};

// Get Single Order
exports.getOrder = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }
    res.json({ success: true, data: order });
  } catch (error) {
    handleErrorResponse(res, error, 'fetch order');
  }
};

// Delete Order
exports.deleteOrder = async (req, res) => {
  try {
    const order = await Order.findByIdAndDelete(req.params.id);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }
    res.json({ success: true, message: 'Order deleted' });
  } catch (error) {
    handleErrorResponse(res, error, 'delete order');
  }
};