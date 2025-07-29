const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const Order = require("../model/Order");
const Client = require('../model/Client.js')
const jwt = require("jsonwebtoken");
const PDFDocument = require("pdfkit");
const emailService = require("../services/emailService");
const Partner = require('../model/Partner.js')


const PRICING = {
  STARTER: 3900,
  TURNKEY: 4600,
  PREMIUM: 9800
};
const COMMISSION_RATE = 0.10; // 10%
exports.generateDownloadToken = async (req, res) => {
  try {
    const { orderId } = req.params;

    console.log("Generating token for order:", orderId); // Add this

    const order = await Order.findOne({
      _id: orderId,
      status: "completed",
    });

    if (!order) {
      console.log("Order not found or not completed:", orderId); // Add this
      return res.status(404).json({
        success: false,
        message: "Order not found or not completed",
      });
    }

    if (!process.env.DOWNLOAD_SECRET) {
      throw new Error("DOWNLOAD_SECRET is not configured");
    }

    const token = jwt.sign(
      { orderId: order._id },
      process.env.DOWNLOAD_SECRET,
      { expiresIn: "5m" }
    );

    console.log("Successfully generated token for order:", orderId); // Add this
    res.json({
      success: true,
      token,
    });
  } catch (error) {
    console.error("Token generation error:", error);
    res.status(500).json({
      success: false,
      message: "Error generating download token",
      error: process.env.NODE_ENV === "development" ? error.message : undefined, // Add this
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
          message: "Invalid or expired download token",
        });
      }
    });

    const order = await Order.findById(orderId);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    // Create PDF
    const doc = new PDFDocument();

    // Set response headers
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=receipt-${order._id}.pdf`
    );

    // PDF content with exact time
    doc.pipe(res);

    // Header
    doc.fontSize(20).text("PAYMENT RECEIPT", { align: "center" });
    doc.moveDown(0.5);
    doc.fontSize(10).text(`Receipt ID#: ${order._id}`, { align: "center" });

    // Add exact time here - modified line
    const receiptDate = new Date(order.createdAt);
    doc.text(
      `Date: ${receiptDate.toLocaleDateString()} ${receiptDate.toLocaleTimeString()}`,
      { align: "center" }
    );
    doc.moveDown(1);

    // Divider
    doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
    doc.moveDown(1);

    // Customer Info
    doc.fontSize(12).text("CUSTOMER INFORMATION", { underline: true });
    doc.fontSize(10).text(`Name: ${order.customerDetails.fullName}`);
    doc.text(`Email: ${order.customerDetails.email}`);
    if (order.phone) doc.text(`Phone: ${order.customerDetails.phone}`);
    doc.moveDown(1);

    // Order Details
    doc.fontSize(12).text("ORDER DETAILS", { underline: true });
    doc.fontSize(10).text(`Plan: ${order.plan}`);
    doc.text(
      `Amount: ${new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "EUR",
      }).format(order.originalPrice)}`
    );
    doc.text(`Payment Status: ${order.status.toUpperCase()}`);
    doc.moveDown(1);

    // Footer
    doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
    doc.moveDown(1);
    doc.fontSize(10).text("Thank you for your business!", { align: "center" });
    doc.text("If you have any questions, please contact our support team.", {
      align: "center",
    });
     doc.fontSize(10).text("Email: bonjour@ouvrir-societe-hong-kong.fr", { align: "center" });

    doc.end();
  } catch (error) {
    console.error("Receipt generation error:", error);
    res.status(500).json({
      success: false,
      message: "Error generating receipt",
    });
  }
};
// controllers/paymentController.js


exports.createPaymentSession = async (req, res) => {
  try {
    const { orderId } = req.body;

    if (!orderId) {
      return res.status(400).json({
        error: "Missing orderId in request body",
      });
    }

    const order = await Order.findById(orderId).populate('client');
    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }

    // Always use originalPrice for payment amount
    const stripeAmount = order.originalPrice * 100; // Convert to cents

    // Create Stripe session with FULL original price
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "eur",
            product_data: {
              name: `${order.plan} Plan`,
              description: 'Company Formation Package'
            },
            unit_amount: stripeAmount,
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: `${process.env.FRONTEND_URL}/payment-success?session_id={CHECKOUT_SESSION_ID}&order_id=${orderId}`,
      cancel_url: `${process.env.FRONTEND_URL}/payment-cancelled`,
      customer_email: order.customerDetails.email,
      metadata: {
        orderId: order._id.toString(),
        source: order.source,
        referralCode: order.referralCode || '',
        partnerId: order.referredBy?.toString() || ''
      }
    });

    // Save session ID to order
    order.stripeSessionId = session.id;
    await order.save();

    res.json({
      url: session.url,
      sessionId: session.id,
      amount: order.originalPrice // Show full price to client
    });

  } catch (error) {
    console.error("Payment session error:", error);
    res.status(500).json({
      error: "Payment processing failed",
      message: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

exports.handleWebhook = async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature verification failed:', err);
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
          paymentConfirmedAt: new Date(),
          paymentMethod: session.payment_method_types[0]
        },
        { new: true }
      ).populate('referredBy');

      // Process commission for referral orders
      if (order?.source === 'REFERRAL' && order.referredBy && !order.isCommissionProcessed) {
        // Calculate 10% of original price
        const commission = Math.floor(order.originalPrice * COMMISSION_RATE);
        
        // Update order with commission
        order.partnerCommission = commission;
        order.finalPrice = order.originalPrice - commission;
        order.isCommissionProcessed = true;
        await order.save();

        // Transfer to partner
        await stripe.transfers.create({
          amount: commission * 100,
          currency: "eur",
          destination: order.referredBy.stripeAccountId,
          description: `Commission for order ${order._id}`
        });

        // Update partner stats
        await Partner.findByIdAndUpdate(order.referredBy._id, {
          $inc: {
            commissionEarned: commission,
            totalReferralSales: order.originalPrice
          },
          $addToSet: {
            ordersReferred: order._id
          }
        });
      }

      // Send confirmation email
      if (order.customerDetails?.email) {
        await emailService.sendPaymentConfirmation(order);
      }

    } catch (err) {
      console.error('Webhook processing error:', err);
    }
  }

  res.json({ received: true });
};
// Add this to your orderController.js
exports.cancelPayment = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { reason = "user_cancelled" } = req.body;
    console.log("Order Id", orderId)

    if (!orderId) {
      return res.status(400).json({
        success: false,
        message: "Order ID is required",
      });
    }

    const order = await Order.findByIdAndUpdate(
      orderId,
      {
        $set: {
          status: "cancelled",
          cancellationReason: reason,
          cancelledAt: new Date(),
        },
        $unset: {
          stripeSessionId: "",
          stripePaymentIntentId: "",
        },
      },
      { new: true, runValidators: true }
    );

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    res.json({
      success: true,
      data: order,
      message: "Order cancelled successfully",
    });
  } catch (error) {
    console.error("Cancel payment error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to cancel payment",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

exports.handleWebhook = async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature verification failed:', err);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    
    try {
      const order = await Order.findByIdAndUpdate(
        session.metadata.orderId,
        {
          status: 'completed',
          paymentIntentId: session.payment_intent,
          paymentConfirmedAt: new Date(),
          paymentMethod: session.payment_method_types[0],
          amountPaid: session.amount_total // Store the actual amount paid
        },
        { new: true }
      ).populate('client');

      if (order?.partnerCommission > 0 && order.referredBy) {
        await Partner.findByIdAndUpdate(
          order.referredBy,
          {
            $inc: {
              commissionEarned: order.partnerCommission,
              totalReferralSales: order.amountPaid || order.finalPrice
            },
            $addToSet: { ordersReferred: order._id }
          }
        );
      }

    } catch (err) {
      console.error('Webhook processing error:', err);
    }
  }

  res.json({ received: true });
};

async function handleCompletedSession(session) {
  try {
    const order = await Order.findByIdAndUpdate(
      session.metadata.orderId,
      {
        status: "completed",
        paymentConfirmedAt: new Date(),
        stripePaymentIntentId: session.payment_intent,
      },
      { new: true }
    );

    // Reward partner if referral was used
    if (
      session.metadata.referralCode &&
      session.metadata.referralCode !== "none"
    ) {
      await Partner.findOneAndUpdate(
        { referralCode: session.metadata.referralCode },
        {
          $inc: {
            totalReferrals: 1,
            totalEarnings: order.price * 0.1, // 10% commission
          },
        }
      );
    }

    // Send receipt
    await emailService.sendPaymentConfirmationEmail(order);
  } catch (error) {
    console.error("Webhook processing error:", error);
  }
}

async function handleFailedSession(session) {
  await Order.findByIdAndUpdate(session.client_reference_id, {
    status: "failed",
    paymentFailedAt: new Date(),
  });
}


// In your paymentController.js
exports.verifyPayment = async (req, res) => {
  try {
    const { sessionId } = req.params;
    
    // Retrieve the Stripe session
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['payment_intent']
    });

    // Validate payment status
    if (!session.payment_intent || session.payment_status !== 'paid') {
      return res.status(400).json({
        success: false,
        message: 'Payment not completed'
      });
    }

    // Find and update the order
    const order = await Order.findOneAndUpdate(
      { stripeSessionId: sessionId },
      {
        status: 'completed',
        paymentIntentId: session.payment_intent.id,
        paymentMethod: session.payment_method_types[0],
        paymentConfirmedAt: new Date()
      },
      { new: true }
    ).populate('client');

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    // Handle referral commission if applicable
    if (order.source === 'REFERRAL' && order.referredBy && !order.partnerCommission) {
      const commission = Math.floor(order.originalPrice * 0.1); // 10% commission
      order.partnerCommission = commission;
      await order.save();
      
      await Partner.findByIdAndUpdate(order.referredBy, {
        $inc: { 
          commissionEarned: commission,
          totalReferralSales: order.finalPrice
        },
        $addToSet: { 
          clientsReferred: order.client._id,
          ordersReferred: order._id 
        }
      });
    }

    // Send confirmation email (fire-and-forget)
    if (order.customerDetails?.email) {
      emailService.sendPaymentConfirmation(order)
        .then(() => console.log('Confirmation email sent'))
        .catch(err => console.error('Email sending failed:', err));
    }

    res.json({ 
      success: true, 
      orderId: order._id,
      isReferral: order.source === 'REFERRAL'
    });

  } catch (error) {
    console.error('Payment verification error:', error);
    res.status(500).json({
      success: false,
      message: 'Error verifying payment',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};
