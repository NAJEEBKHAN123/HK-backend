const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const Order = require('../model/Order');
const jwt = require('jsonwebtoken');
const PDFDocument = require('pdfkit');




exports.generateDownloadToken = async (req, res) => {
  try {
    const { orderId } = req.params;
    
    console.log('Generating token for order:', orderId); // Add this
    
    const order = await Order.findOne({ 
      _id: orderId,
      status: 'completed'
    });
    
    if (!order) {
      console.log('Order not found or not completed:', orderId); // Add this
      return res.status(404).json({ 
        success: false,
        message: 'Order not found or not completed' 
      });
    }

    if (!process.env.DOWNLOAD_SECRET) {
      throw new Error('DOWNLOAD_SECRET is not configured');
    }

    const token = jwt.sign(
      { orderId: order._id },
      process.env.DOWNLOAD_SECRET,
      { expiresIn: '5m' }
    );

    console.log('Successfully generated token for order:', orderId); // Add this
    res.json({ 
      success: true,
      token 
    });

  } catch (error) {
    console.error('Token generation error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Error generating download token',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined // Add this
    });
  }
};

// Download receipt
// In your paymentController.js (backend) - modify the downloadReceipt function
exports.downloadReceipt = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { token, timestamp } = req.query;

    // Verify token and timestamp
    jwt.verify(token, process.env.DOWNLOAD_SECRET, (err, decoded) => {
      if (err || decoded.orderId !== orderId) {
        return res.status(403).json({ 
          success: false,
          message: 'Invalid or expired download token' 
        });
      }
    });

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ 
        success: false,
        message: 'Order not found' 
      });
    }

    // Create PDF
    const doc = new PDFDocument();
    
    // Set response headers
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=receipt-${order._id}.pdf`);

    // PDF content with exact time
    doc.pipe(res);
    
    // Header
    doc.fontSize(20).text('PAYMENT RECEIPT', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(10).text(`Receipt #: ${order._id}`, { align: 'center' });
    
    // Add exact time here - modified line
    const receiptDate = new Date(order.createdAt);
    doc.text(`Date: ${receiptDate.toLocaleDateString()} ${receiptDate.toLocaleTimeString()}`, { align: 'center' });
    doc.moveDown(1);
    
    // Divider
    doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
    doc.moveDown(1);
    
    // Customer Info
    doc.fontSize(12).text('CUSTOMER INFORMATION', { underline: true });
    doc.fontSize(10).text(`Name: ${order.fullName}`);
    doc.text(`Email: ${order.email}`);
    if (order.phone) doc.text(`Phone: ${order.phone}`);
    doc.moveDown(1);
    
    // Order Details
    doc.fontSize(12).text('ORDER DETAILS', { underline: true });
    doc.fontSize(10).text(`Plan: ${order.plan}`);
    doc.text(`Amount: ${new Intl.NumberFormat('en-US', { 
      style: 'currency', 
      currency: 'EUR' 
    }).format(order.price)}`);
    doc.text(`Payment Status: ${order.status.toUpperCase()}`);
    doc.moveDown(1);
    
    // Footer
    doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
    doc.moveDown(1);
    doc.fontSize(10).text('Thank you for your business!', { align: 'center' });
    doc.text('If you have any questions, please contact our support team.', { align: 'center' });
    
    doc.end();

  } catch (error) {
    console.error('Receipt generation error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Error generating receipt' 
    });
  }
};

exports.createPaymentSession = async (req, res) => {
  try {
    const { orderId } = req.body;
    
    // Validate input
    if (!orderId) {
      return res.status(400).json({ 
        success: false,
        message: 'Order ID is required' 
      });
    }

    // Get order from database
    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ 
        success: false,
        message: 'Order not found' 
      });
    }

    // Create checkout session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'eur',
          product_data: {
            name: order.plan,
            description: `Payment for ${order.plan}`,
          },
          unit_amount: order.price * 100, // Convert to cents
        },
        quantity: 1,
      }],
      mode: 'payment',
      success_url: `${process.env.FRONTEND_URL}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL}/payment-cancelled?order_id=${orderId}`,
      customer_email: order.email,
      client_reference_id: orderId,
      metadata: {
        orderId: orderId.toString(),
        plan: order.plan
      },
      payment_intent_data: {
        description: `Payment for ${order.plan}`,
        metadata: {
          orderId: orderId.toString()
        }
      }
    });

    // Update order with session ID
    order.stripeSessionId = session.id;
    order.status = 'processing';
    await order.save();

    res.json({ 
      success: true,
      url: session.url 
    });

  } catch (error) {
    console.error('Payment session error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Error creating payment session',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Add this to your orderController.js
exports.cancelPayment = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { reason = 'user_cancelled' } = req.body;

    if (!orderId) {
      return res.status(400).json({
        success: false,
        message: 'Order ID is required'
      });
    }

    const order = await Order.findByIdAndUpdate(
      orderId,
      {
        $set: {
          status: 'cancelled',
          cancellationReason: reason,
          cancelledAt: new Date()
        },
        $unset: {
          stripeSessionId: "",
          stripePaymentIntentId: ""
        }
      },
      { new: true, runValidators: true }
    );

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    res.json({
      success: true,
      data: order,
      message: 'Order cancelled successfully'
    });

  } catch (error) {
    console.error('Cancel payment error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to cancel payment',
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
    console.error('Webhook verification failed:', err);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle successful payment
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    
    try {
      const order = await Order.findOneAndUpdate(
        { _id: session.client_reference_id },
        { 
          status: 'completed',
          paymentConfirmedAt: new Date(),
          stripePaymentIntentId: session.payment_intent,
          paymentMethod: session.payment_method_types[0],
          transactionReference: session.id
        },
        { new: true }
      );

      if (!order) {
        console.error('Order not found for session:', session.id);
        return res.status(404).json({ success: false });
      }

      // Here you would typically:
      // 1. Send confirmation email
      // 2. Trigger any post-payment processes
      // 3. Update inventory if needed

    } catch (err) {
      console.error('Order update error:', err);
      return res.status(500).json({ success: false });
    }
  }

  res.json({ received: true });
};

// In your paymentController.js
exports.verifyPayment = async (req, res) => {
  try {
    const { sessionId } = req.params;

    // Retrieve Stripe session
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['payment_intent']
    });

    if (!session.payment_intent || session.payment_status !== 'paid') {
      return res.status(400).json({ 
        success: false,
        message: 'Payment not completed' 
      });
    }

    // Find and update order
    const order = await Order.findOneAndUpdate(
      { stripeSessionId: sessionId },
      { 
        status: 'completed',
        paymentConfirmedAt: new Date(),
        stripePaymentIntentId: session.payment_intent.id
      },
      { new: true }
    );

    if (!order) {
      return res.status(404).json({ 
        success: false,
        message: 'Order not found' 
      });
    }

    res.json({
      success: true,
      orderId: order._id
    });

  } catch (error) {
    console.error('Payment verification error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Error verifying payment'
    });
  }
};