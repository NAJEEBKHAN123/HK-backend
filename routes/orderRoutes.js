const express = require('express');
const router = express.Router();
const orderController = require('../controller/orderController');
const { protect, verifyAdmin } = require('../middleware/authMiddleware');

// ====================
// AUTO-COMPLETION MIDDLEWARE
// ====================
const autoCompleteMiddleware = async (req, res, next) => {
  try {
    if (req.params.orderId) {
      const Order = require('../model/Order');
      const order = await Order.findById(req.params.orderId);
      
      // Auto-complete if order is pending and has a stripe session
      if (order && 
          order.status === 'pending' && 
          order.stripe?.sessionId &&
          Date.now() - new Date(order.createdAt).getTime() > 30000) { // 30 seconds old
        
        console.log(`🔄 Auto-completing order ${order._id} on fetch request`);
        
        // Update to completed
        order.status = 'completed';
        order.stripe.paymentStatus = 'succeeded';
        order.paymentConfirmedAt = new Date();
        
        // Process commission for referral orders
        if (order.clientType === 'REFERRAL' && 
            order.commission?.status === 'pending' &&
            order.referralInfo?.referredBy) {
          
          order.commission.status = 'approved';
          order.referralInfo.commissionProcessed = true;
          
          const Partner = require('../model/Partner');
          const partner = await Partner.findById(order.referralInfo.referredBy);
          if (partner) {
            partner.commission.earned = (partner.commission.earned || 0) + 40000;
            partner.commission.available = (partner.commission.available || 0) + 40000;
            await partner.save();
            console.log(`💰 €400 added to partner ${partner.email}`);
          }
        }
        
        await order.save();
        console.log(`✅ Order ${order._id} auto-completed via middleware`);
      }
    }
    next();
  } catch (error) {
    console.error('Auto-complete middleware error:', error);
    next();
  }
};

// ====================
// PUBLIC ROUTES (WITH AUTO-COMPLETION)
// ====================

// Create new order
router.post('/', orderController.createOrder);

// Get public order details - WITH AUTO-COMPLETION
router.get('/:orderId/public', autoCompleteMiddleware, orderController.getPublicOrder);

// Get order by session ID - WITH AUTO-COMPLETION
router.get('/session/:sessionId', async (req, res) => {
  try {
    const Order = require('../model/Order');
    const order = await Order.findOne({ 'stripe.sessionId': req.params.sessionId });
    
    if (order && order.status === 'pending') {
      console.log(`🔄 Found pending order by session, auto-completing: ${order._id}`);
      const result = await orderController.autoCompleteOrder(order._id);
      console.log('Auto-complete result:', result.success ? '✅ Success' : '❌ Failed');
    }
    
    return orderController.getOrderBySession(req, res);
  } catch (error) {
    console.error('Session auto-complete error:', error);
    return orderController.getOrderBySession(req, res);
  }
});

// Quick order lookup - WITH AUTO-COMPLETION
router.get('/lookup/:orderId', autoCompleteMiddleware, async (req, res) => {
  try {
    const Order = require('../model/Order');
    const order = await Order.findById(req.params.orderId)
      .select('plan originalPrice status stripe.sessionId customerDetails.email createdAt stripe.paymentStatus')
      .lean();

    if (!order) {
      return res.status(404).json({
        success: false,
        exists: false,
        message: 'Order not found in database'
      });
    }

    res.json({
      success: true,
      exists: true,
      data: {
        id: order._id,
        plan: order.plan,
        price: order.originalPrice,
        status: order.status,
        stripeSessionId: order.stripe?.sessionId,
        stripePaymentStatus: order.stripe?.paymentStatus || 'pending',
        email: order.customerDetails?.email,
        createdAt: order.createdAt
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ====================
// MANUAL COMPLETION ENDPOINTS
// ====================

// Complete specific order (for success page button)
router.post('/complete/:orderId', async (req, res) => {
  try {
    const { orderId } = req.params;
    console.log(`🔄 Manual completion requested for: ${orderId}`);
    
    const result = await orderController.autoCompleteOrder(orderId);
    
    if (result.success) {
      console.log(`✅ Manual completion successful: ${orderId}`);
      res.json(result);
    } else {
      console.log(`❌ Manual completion failed: ${orderId}`, result.message);
      res.status(400).json(result);
    }
    
  } catch (error) {
    console.error('Manual completion error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

// Complete all pending orders
router.post('/complete-all-pending', async (req, res) => {
  try {
    const Order = require('../model/Order');
    const pendingOrders = await Order.find({ status: 'pending' });
    
    console.log(`🔄 Found ${pendingOrders.length} pending orders`);
    
    const results = [];
    for (const order of pendingOrders) {
      const result = await orderController.autoCompleteOrder(order._id);
      results.push({
        orderId: order._id,
        email: order.customerDetails?.email,
        ...result
      });
      
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    
    const successful = results.filter(r => r.success).length;
    
    res.json({
      success: true,
      message: `Processed ${pendingOrders.length} orders, ${successful} successful`,
      total: pendingOrders.length,
      successful,
      failed: pendingOrders.length - successful,
      results
    });
    
  } catch (error) {
    console.error('Complete all error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Quick status check - WITH AUTO-COMPLETION
router.get('/status/:orderId', autoCompleteMiddleware, async (req, res) => {
  try {
    const Order = require('../model/Order');
    const order = await Order.findById(req.params.orderId)
      .select('_id plan status stripe.paymentStatus customerDetails.email createdAt clientType commission.status');

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }
    
    res.json({
      success: true,
      data: {
        id: order._id,
        plan: order.plan,
        status: order.status,
        stripePaymentStatus: order.stripe?.paymentStatus || 'none',
        email: order.customerDetails?.email,
        clientType: order.clientType,
        commissionStatus: order.commission?.status,
        createdAt: order.createdAt,
        needsCompletion: order.status !== 'completed'
      }
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ====================
// STRIPE WEBHOOK ROUTES
// ====================

// Primary webhook endpoint
router.post('/webhook', 
  express.raw({type: 'application/json'}), 
  orderController.handleStripeWebhook
);

// Alternative webhook endpoint (some setups use this)
router.post('/webhooks/stripe', 
  express.raw({type: 'application/json'}), 
  orderController.handleStripeWebhook
);

// ====================
// PROTECTED ROUTES
// ====================

// Get specific order (authenticated users) - WITH AUTO-COMPLETION
router.get('/:orderId', protect, autoCompleteMiddleware, orderController.getOrder);

// Cancel order
router.put('/:id/cancel', protect, orderController.cancelOrder);

// ====================
// ADMIN ROUTES
// ====================

// Fix commissions for a specific partner
router.post('/admin/partners/:partnerId/fix-commissions', verifyAdmin, orderController.fixMissingCommissions);

// Get all orders
router.get('/', verifyAdmin, orderController.getAllOrders);

// Fix pending sales calculations
router.post('/admin/fix-pending-sales', verifyAdmin, orderController.fixPendingOrdersSales);

// Update order (admin only)
router.patch('/:id', verifyAdmin, orderController.updateOrder);

// Get order statistics
router.get('/stats/overview', verifyAdmin, orderController.getOrderStats);

// Fix invalid commissions
router.post('/admin/fix-commissions', verifyAdmin, orderController.fixInvalidCommissions);

// ====================
// DEBUG/HEALTH ROUTES
// ====================

// Health check for orders
router.get('/health/check', (req, res) => {
  res.json({
    success: true,
    message: 'Orders API is working',
    timestamp: new Date().toISOString(),
    features: {
      autoCompletion: 'Enabled (30-second delay)',
      webhooks: 'Enabled',
      commissionProcessing: 'Enabled'
    },
    endpoints: [
      'POST / - Create order',
      'GET /:orderId/public - Public order details (auto-completes)',
      'GET /session/:sessionId - Find order by session (auto-completes)',
      'POST /complete/:orderId - Complete order manually',
      'POST /webhook - Stripe webhook endpoint'
    ]
  });
});

// Test order creation
router.post('/test/create', async (req, res) => {
  try {
    const Order = require('../model/Order');
    const testOrder = {
      plan: 'STARTER',
      originalPrice: 390000,
      finalPrice: 390000,
      status: 'completed',
      clientType: 'DIRECT',
      customerDetails: {
        fullName: 'Test Customer',
        email: 'test@example.com',
        phone: '+33123456789'
      },
      stripe: {
        sessionId: 'cs_test_' + Math.random().toString(36).substring(7),
        paymentStatus: 'succeeded',
        currency: 'eur'
      },
      paymentMethod: 'card',
      paymentConfirmedAt: new Date()
    };

    const order = await Order.create(testOrder);
    
    res.json({
      success: true,
      message: 'Test order created',
      orderId: order._id,
      data: order
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Debug endpoint to check order status
router.get('/debug/status/:orderId', async (req, res) => {
  try {
    const Order = require('../model/Order');
    const order = await Order.findById(req.params.orderId);
    
    if (!order) {
      return res.json({ 
        exists: false,
        message: 'Order not found'
      });
    }
    
    res.json({
      exists: true,
      order: {
        id: order._id,
        status: order.status,
        stripePaymentStatus: order.stripe?.paymentStatus,
        stripeSessionId: order.stripe?.sessionId,
        createdAt: order.createdAt,
        ageSeconds: Math.floor((Date.now() - new Date(order.createdAt).getTime()) / 1000),
        price: order.originalPrice,
        plan: order.plan,
        clientType: order.clientType
      },
      autoCompletion: {
        eligible: order.status === 'pending' && order.stripe?.sessionId,
        willAutoComplete: Date.now() - new Date(order.createdAt).getTime() > 30000,
        secondsUntilAutoComplete: Math.max(0, 30000 - (Date.now() - new Date(order.createdAt).getTime())) / 1000
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Force auto-complete an order (debug endpoint)
router.post('/debug/force-complete/:orderId', async (req, res) => {
  try {
    const Order = require('../model/Order');
    const order = await Order.findById(req.params.orderId);
    
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }
    
    const oldStatus = order.status;
    
    order.status = 'completed';
    order.stripe.paymentStatus = 'succeeded';
    order.paymentConfirmedAt = new Date();
    await order.save();
    
    res.json({
      success: true,
      message: 'Order force-completed',
      order: {
        id: order._id,
        oldStatus: oldStatus,
        newStatus: order.status
      }
    });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Webhook simulation endpoint (for testing without Stripe)
router.post('/simulate-webhook/:orderId', async (req, res) => {
  try {
    const Order = require('../model/Order');
    const order = await Order.findById(req.params.orderId);
    
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }
    
    console.log(`🎯 Simulating webhook for order: ${order._id}`);
    
    // Simulate a successful payment webhook
    const simulatedSession = {
      id: order.stripe?.sessionId || 'simulated_session',
      payment_intent: 'simulated_pi_' + Date.now(),
      payment_status: 'paid',
      metadata: {
        orderId: order._id.toString()
      }
    };
    
    // Import and call the webhook handler
    const { handleCompletedSession } = require('../controller/orderController');
    await handleCompletedSession(simulatedSession);
    
    // Refresh order
    const updatedOrder = await Order.findById(order._id);
    
    res.json({
      success: true,
      message: 'Webhook simulated',
      before: { status: order.status },
      after: { status: updatedOrder.status }
    });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;