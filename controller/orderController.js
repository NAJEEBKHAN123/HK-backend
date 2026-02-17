// controller/orderController.js - INSTANT TRANSFER VERSION
const Client = require('../model/Client');
const Partner = require('../model/Partner');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const Order = require('../model/Order');
const EmailService = require('../services/emailService');
const CommissionTransaction = require('../model/CommissionTransaction');
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
// ============ CREATE ORDER FUNCTION (FIXED) ============
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
        message: 'Missing required fields' 
      });
    }

    if (!PRICING[plan]) {
      return res.status(400).json({ 
        success: false,
        message: 'Invalid plan selected' 
      });
    }

    // ========== FIND OR CREATE CLIENT ==========
    const clientEmail = customerDetails.email.toLowerCase();
    let client = await Client.findOne({ email: clientEmail });
    let partner = null;
    let clientType = 'DIRECT';

    if (!client) {
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

    // ========== HANDLE REFERRAL CODE ==========
    if (referralCode && referralCode.trim()) {
      console.log(`🔍 Looking for partner with code: "${referralCode.trim()}"`);
      
      partner = await Partner.findOne({ 
        referralCode: referralCode.trim(),
        status: 'active'
      });

      if (partner) {
        console.log(`✅ Found partner: ${partner.name}`);
        clientType = 'REFERRAL';
        
        client.clientType = 'REFERRAL';
        client.referredBy = partner._id;
        client.referralCode = referralCode.trim();
        await client.save();
        
        console.log(`✅ Client marked as referral for partner ${partner.name}`);
      }
    }

    // ========== CREATE ORDER ==========
    const originalPrice = PRICING[plan];
    
    const orderData = {
      plan,
      customerDetails: {
        ...customerDetails,
        email: clientEmail
      },
      originalPrice: originalPrice,
      finalPrice: originalPrice,
      status: 'pending', // Order starts as pending
      clientType: clientType,
      client: client._id,
      stripe: {
        paymentStatus: 'pending',
        currency: 'eur',
        amountPaid: originalPrice
      }
    };

    // Add referral info if partner exists
    if (partner && clientType === 'REFERRAL') {
      orderData.referralInfo = {
        referralCode: referralCode.trim(),
        referredBy: partner._id,
        partnerName: partner.name,
        partnerEmail: partner.email,
        partnerStripeAccountId: partner.stripeConnect?.accountId || null,
        commissionProcessed: false
      };
      
      orderData.commission = {
        amount: FIXED_COMMISSION,
        status: 'pending' // Commission starts as pending
      };
      
      console.log(`💰 €400 commission will be paid to partner ${partner.name} WHEN ORDER COMPLETES`);
    }

    const order = await Order.create(orderData);
    console.log(`✅ Order created: ${order._id}, Type: ${clientType}, Status: pending`);

    // Update client with order
    await Client.findByIdAndUpdate(client._id, {
      $push: { orders: order._id }
    });

    // 🔥 FIXED: Only link order to partner, DO NOT add to sales yet
    if (partner && clientType === 'REFERRAL') {
      partner.referrals.orders = partner.referrals.orders || [];
      if (!partner.referrals.orders.includes(order._id)) {
        // Link order to partner but DON'T add to sales yet
        partner.referrals.orders.push(order._id);
        partner.referrals.totalOrders = (partner.referrals.totalOrders || 0) + 1;
        
        // ⚠️ CRITICAL FIX: DON'T add to totalSales here - only when order is completed
        // partner.referrals.totalSales = (partner.referrals.totalSales || 0) + order.finalPrice;
        
        if (order.client && !partner.referrals.clients.includes(order.client._id)) {
          partner.referrals.clients.push(order.client._id);
          partner.referrals.totalClients = (partner.referrals.totalClients || 0) + 1;
        }
        
        await partner.save();
        console.log(`✅ Order ${order._id} linked to partner ${partner.name} (status: pending)`);
      }
    }

        // ========== CREATE STRIPE SESSION WITH INSTANT TRANSFER ==========
    const stripeAmountInCents = order.finalPrice;
    
    const sessionConfig = {
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'eur',
          product_data: {
            name: `${plan} Plan - Company Formation`,
            description: 'Complete company formation package in Hong Kong'
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
        commissionAmount: '40000',
        plan: plan,
        amount: stripeAmountInCents.toString()
      }
    };

    // 🔥 INSTANT COMMISSION TRANSFER SETUP
    if (clientType === 'REFERRAL' && 
        partner?.stripeConnect?.accountId && 
        partner.stripeConnect.chargesEnabled &&
        partner.stripeConnect.status === 'active') {
      
      console.log(`🚀 Setting up INSTANT €400 transfer to ${partner.name}`);
      
      sessionConfig.payment_intent_data = {
        // Partner receives €400 instantly
        transfer_data: {
          destination: partner.stripeConnect.accountId,
          amount: FIXED_COMMISSION, // €400 goes to partner
        },
        // Track the transfer
        metadata: {
          ...sessionConfig.metadata,
          instantTransfer: 'true',
          partnerStripeAccount: partner.stripeConnect.accountId,
          transferAmount: '40000'
        }
      };
      
      console.log(`✅ Instant transfer configured: €400 → ${partner.email}`);
    } else if (clientType === 'REFERRAL') {
      console.log(`⚠️ Partner ${partner.name} doesn't have Stripe Connect - commission will be manual`);
    }

    const session = await stripe.checkout.sessions.create(sessionConfig);

    order.stripe.sessionId = session.id;
    await order.save();

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
        platformEarnings: (order.finalPrice - FIXED_COMMISSION) / 100,
        paymentMethod: partner?.stripeConnect?.accountId ? 'instant_transfer' : 'manual'
      };
    }

    console.log(`✅ Order creation complete. Stripe URL: ${session.url}`);
    
    res.json(response);

  } catch (error) {
    console.error('❌ Order creation error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Order creation failed'
    });
  }
};

// ========== AUTO-COMPLETE ORDER FUNCTION ==========
// ========== AUTO-COMPLETE ORDER FUNCTION (FIXED) ==========
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
    
    // Store old status for logging
    const oldStatus = order.status;
    
    // Update order status to completed
    order.status = 'completed';
    order.stripe.paymentStatus = 'succeeded';
    order.paymentConfirmedAt = new Date();
    order.stripe.paymentMethod = 'card';
    order.transactionReference = order.stripe.sessionId || `auto_${Date.now()}`;
    
    console.log(`✅ Order ${orderId} status changed from ${oldStatus} to completed`);
    
    // 🔥 FIXED: If it's a referral order, add to partner's total sales NOW
    if (order.clientType === 'REFERRAL' && order.referralInfo.referredBy) {
      const partner = await Partner.findById(order.referralInfo.referredBy);
      if (partner) {
        // Add to partner's total sales (only now when order is completed)
        const orderAmount = order.finalPrice || order.originalPrice || 0;
        partner.referrals.totalSales = (partner.referrals.totalSales || 0) + orderAmount;
        console.log(`💰 Added €${orderAmount/100} to partner ${partner.name}'s total sales`);
        
        await partner.save();
      }
    }
    
    // Process commission if order is referral and commission is pending
    if (order.clientType === 'REFERRAL' && order.commission.status === 'pending') {
      const commissionAmount = order.commission.amount || 40000;
      
      console.log(`💰 Processing €${commissionAmount/100} commission for order ${orderId}`);
      
      order.commission.status = 'approved';
      order.referralInfo.commissionProcessed = true;
      
      // Update partner's commission
      if (order.referralInfo.referredBy) {
        const partner = await Partner.findById(order.referralInfo.referredBy);
        if (partner) {
          const CommissionTransaction = require('../model/CommissionTransaction');
          
          let validAmount = Number(commissionAmount);
          if (isNaN(validAmount) || validAmount <= 0) {
            console.warn(`⚠️ Invalid commission amount: ${commissionAmount}, using default €400`);
            validAmount = 40000;
          }
          
          // Create commission transaction
          try {
            const commissionTransaction = await CommissionTransaction.create({
              partner: partner._id,
              order: order._id,
              amount: validAmount,
              type: 'EARNED',
              status: 'COMPLETED',
              description: `€${validAmount/100} commission for completed order #${orderId}`,
              metadata: {
                orderAmount: order.finalPrice,
                orderDate: order.createdAt,
                customerEmail: order.customerDetails?.email || 'Unknown'
              }
            });
            
            console.log(`✅ Commission transaction created: ${commissionTransaction._id}`);
          } catch (commissionError) {
            console.error('❌ Commission creation failed:', commissionError.message);
          }
          
          // Update partner's totals
          partner.commission.earned = (partner.commission.earned || 0) + validAmount;
          partner.commission.available = (partner.commission.available || 0) + validAmount;
          
          // Update partner referrals (clients and orders already linked in createOrder)
          if (order.client && !partner.referrals.clients?.includes(order.client._id)) {
            partner.referrals.clients = partner.referrals.clients || [];
            partner.referrals.clients.push(order.client._id);
          }
          
          if (!partner.referrals.orders?.includes(order._id)) {
            partner.referrals.orders = partner.referrals.orders || [];
            partner.referrals.orders.push(order._id);
          }
          
          await partner.save();
          
          console.log(`✅ €${validAmount/100} commission added to partner ${partner.email} for completed order`);
        }
      }
    }
    
    await order.save();
    console.log(`✅ Order ${orderId} marked as completed and commission processed`);
    
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

// ========== WEBHOOK HANDLERS ==========

// 🔥 Handle instant transfer webhook
async function handleInstantTransfer(paymentIntent) {
  try {
    console.log('💰 Checking for instant transfer in payment intent:', paymentIntent.id);
    
    // Try to find order by payment intent ID
    let order = await Order.findOne({ 
      'stripe.paymentIntentId': paymentIntent.id 
    }).populate('referralInfo.referredBy');
    
    // If not found by paymentIntentId, try by session
    if (!order) {
      console.log(`🔍 Order not found by paymentIntentId, checking session metadata...`);
      
      // Get session ID from payment intent
      if (paymentIntent.metadata?.sessionId) {
        order = await Order.findOne({ 
          'stripe.sessionId': paymentIntent.metadata.sessionId 
        }).populate('referralInfo.referredBy');
      }
    }
    
    if (!order || order.clientType !== 'REFERRAL') {
      console.log(`ℹ️ No referral order found for payment intent: ${paymentIntent.id}`);
      return;
    }
    
    // Check if transfer_data exists (instant transfer was configured)
    if (paymentIntent.transfer_data?.destination) {
      console.log(`✅ Instant transfer confirmed to: ${paymentIntent.transfer_data.destination}`);
      
      // Update order commission status
      order.commission.status = 'paid';
      order.commission.paidAt = new Date();
      order.commission.paymentMethod = 'stripe_connect_instant';
      order.commission.stripeTransferId = paymentIntent.id;
      
      await order.save();
      
      // Create commission transaction
      await CommissionTransaction.create({
        partner: order.referralInfo.referredBy,
        order: order._id,
        amount: 40000,
        type: 'PAID_OUT',
        status: 'COMPLETED',
        description: `Instant €400 transfer via Stripe Connect for order #${order._id}`,
        paymentMethod: 'stripe_connect',
        transactionId: paymentIntent.id,
        metadata: {
          instantTransfer: true,
          destinationAccount: paymentIntent.transfer_data.destination,
          transferDate: new Date()
        }
      });
      
      console.log(`✅ €400 instantly transferred to partner for order ${order._id}`);
    }
  } catch (error) {
    console.error('❌ Instant transfer handler error:', error);
  }
}

// Handle completed session
// Replace this function:
async function handleCompletedSession(session) {
  try {
    const order = await Order.findOne({ 'stripe.sessionId': session.id })
      .populate('client')
      .populate('referralInfo.referredBy');

    if (!order) {
      console.error(`❌ Order not found for session: ${session.id}`);
      return;
    }

    console.log(`✅ Found order: ${order._id}, Client type: ${order.clientType}`);
    
    // 🚨 CRITICAL FIX: Update order status BEFORE processing
    order.status = 'completed';
    order.stripe.paymentIntentId = session.payment_intent;
    order.stripe.paymentStatus = 'succeeded';
    order.paymentConfirmedAt = new Date();
    
    // Save order FIRST
    await order.save();
    console.log(`✅ Order ${order._id} marked as completed via webhook`);

    // Now process commission if needed
    if (order.clientType === 'REFERRAL' && 
        order.referralInfo.referredBy && 
        order.commission.status !== 'paid') {
      
      const partner = await Partner.findById(order.referralInfo.referredBy);
      if (partner) {
        // Check if instant transfer was configured
        if (order.referralInfo.partnerStripeAccountId && 
            partner.stripeConnect?.accountId) {
          
          console.log(`✅ Instant transfer already configured for partner ${partner.name}`);
          order.commission.status = 'paid';
          order.commission.paidAt = new Date();
        } else {
          // Manual commission - add to available balance
          partner.commission.earned = (partner.commission.earned || 0) + 40000;
          partner.commission.available = (partner.commission.available || 0) + 40000;
          await partner.save();
          
          order.commission.status = 'approved';
          order.commission.amount = 40000;
          
          // Create commission transaction
          await CommissionTransaction.create({
            partner: partner._id,
            order: order._id,
            amount: 40000,
            type: 'EARNED',
            status: 'COMPLETED',
            description: `€400 commission for order #${order._id}`,
            metadata: {
              orderAmount: order.finalPrice,
              paymentMethod: 'manual_payout_required',
              processedVia: 'webhook'
            }
          });
          
          console.log(`✅ €400 commission added to partner ${partner.email} via webhook`);
        }
      }
    }

    // Save order again with updated commission status
    await order.save();
    
    // Send email
    try {
      await EmailService.sendPaymentSuccess(order);
      console.log(`📧 Confirmation email sent for order ${order._id}`);
    } catch (emailError) {
      console.error('Email error:', emailError);
    }
    
  } catch (error) {
    console.error('❌ Error handling completed session:', error);
  }
}

// Handle successful payment
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

// Handle failed payment
async function handleFailedPayment(paymentIntent) {
  try {
    const order = await Order.findOne({ 'stripe.paymentIntentId': paymentIntent.id });
    if (order) {
      order.status = 'failed';
      order.stripe.paymentStatus = 'failed';
      await order.save();
      console.log(`❌ Payment failed for order ${order._id}`);
    }
  } catch (error) {
    console.error('Error handling failed payment:', error);
  }
}

// Handle transfer created
async function handleTransferCreated(transfer) {
  try {
    console.log(`📤 Transfer created: ${transfer.id}, Amount: €${transfer.amount / 100}`);
    
    const orderId = transfer.metadata?.orderId;
    if (!orderId) return;
    
    const order = await Order.findById(orderId);
    if (order && order.clientType === 'REFERRAL') {
      order.commission.stripeTransferId = transfer.id;
      await order.save();
      
      console.log(`✅ Transfer ${transfer.id} linked to order ${orderId}`);
    }
  } catch (error) {
    console.error('❌ Error handling transfer:', error);
  }
}

// Handle payout paid
async function handleTransferPaid(transfer) {
  try {
    console.log(`✅ Transfer paid: ${transfer.id}`);
    
    await CommissionTransaction.updateOne(
      { transactionId: transfer.id },
      { $set: { status: 'COMPLETED', updatedAt: new Date() } }
    );
  } catch (error) {
    console.error('❌ Error handling transfer paid:', error);
  }
}

// Check and process auto-payout
async function checkAndProcessAutoPayout(partner, commissionAmount, orderId) {
  try {
    // Check if partner has active Stripe Connect
    if (!partner.stripeConnect?.accountId || 
        !partner.stripeConnect.chargesEnabled || 
        !partner.stripeConnect.payoutsEnabled) {
      console.log(`ℹ️ Partner ${partner.email} doesn't have active Stripe Connect or not ready for payouts`);
      return false;
    }
    
    // Check auto-payout settings
    if (!partner.autoPayoutEnabled) {
      console.log(`ℹ️ Auto-payout disabled for partner ${partner.email}`);
      return false;
    }
    
    // Check if meets threshold (default €100)
    const availableCommission = partner.commission.available + commissionAmount;
    const payoutThreshold = partner.payoutThreshold || 10000; // €100 in cents
    
    if (availableCommission >= payoutThreshold) {
      console.log(`💰 Partner ${partner.email} meets auto-payout threshold (€${payoutThreshold/100})`);
      
      try {
        const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
        
        // Transfer to partner's Stripe account
        const transfer = await stripe.transfers.create({
          amount: availableCommission,
          currency: 'eur',
          destination: partner.stripeConnect.accountId,
          description: `Auto-payout commission for order #${orderId}`,
          metadata: {
            type: 'auto_payout',
            orderId: orderId,
            partnerId: partner._id.toString()
          }
        });
        
        console.log(`✅ Auto-transfer created: ${transfer.id} for €${(availableCommission/100).toFixed(2)}`);
        
        // Create payout transaction
        const CommissionTransaction = require('../model/CommissionTransaction');
        await CommissionTransaction.create({
          partner: partner._id,
          order: orderId,
          amount: availableCommission,
          type: 'PAID_OUT',
          status: 'COMPLETED',
          description: `Auto-payout via Stripe Connect for order #${orderId}`,
          paymentMethod: 'stripe_connect',
          transactionId: transfer.id,
          stripeTransferId: transfer.id,
          balanceBefore: partner.commission.available,
          balanceAfter: 0,
          metadata: {
            autoPayout: true,
            triggerOrder: orderId,
            stripeAccount: partner.stripeConnect.accountId
          }
        });
        
        // Update partner commission
        partner.commission.paid = (partner.commission.paid || 0) + availableCommission;
        partner.commission.available = 0;
        partner.lastPayoutAt = new Date();
        
        console.log(`✅ Auto-payout completed for partner ${partner.email}: €${(availableCommission/100).toFixed(2)}`);
        
        return true;
        
      } catch (payoutError) {
        console.error(`❌ Auto-payout failed for ${partner.email}:`, payoutError.message);
        return false;
      }
    } else {
      console.log(`ℹ️ Partner ${partner.email} has €${(availableCommission/100).toFixed(2)}, needs €${(payoutThreshold/100)} for auto-payout`);
      return false;
    }
  } catch (error) {
    console.error(`❌ Auto-payout check failed for ${partner.email}:`, error.message);
    return false;
  }
}

// ========== WEBHOOK HANDLER WITH INSTANT TRANSFER TRACKING ==========
exports.handleStripeWebhook = async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;
  
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
    
    console.log(`✅ Webhook verified: ${event.type} (ID: ${event.id})`);
    
  } catch (err) {
    console.error('❌ Webhook verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
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
        await handleInstantTransfer(event.data.object);
        await handlePaymentIntentMetadata(event.data.object);
        break;
        
      case 'payment_intent.payment_failed':
        console.log('❌ Payment intent failed');
        await handleFailedPayment(event.data.object);
        break;
        
      case 'transfer.created':
        console.log('💸 Transfer created');
        await handleTransferCreated(event.data.object);
        break;
        
      case 'transfer.paid':
        console.log('✅ Transfer paid to partner');
        await handleTransferPaid(event.data.object);
        break;
        
      default:
        console.log(`🤔 Unhandled event type: ${event.type}`);
    }
  } catch (error) {
    console.error('❌ Webhook processing error:', error);
  }

  res.json({ received: true, processed: true });
};


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
      order.referralInfo.commissionProcessed = true;
      await order.save();
      
      const partner = await Partner.findById(order.referralInfo.referredBy);
      if (partner) {
        // Update partner commission
        partner.commission.earned = (partner.commission.earned || 0) + 40000;
        partner.commission.available = (partner.commission.available || 0) + 40000;
        await partner.save();
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
          order.referralInfo.commissionProcessed = true;
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

// Add this function to your orderController.js
exports.fixInvalidCommissions = async (req, res) => {
  try {
    console.log('🔧 Starting commission fix process...');
    
    // Find orders with invalid commission amounts
    const invalidOrders = await Order.find({
      clientType: 'REFERRAL',
      $or: [
        { 'commission.amount': { $exists: false } },
        { 'commission.amount': { $type: 'string' } },
        { 'commission.amount': null },
        { 'commission.amount': 0 }
      ]
    });
    
    console.log(`🔧 Found ${invalidOrders.length} orders with invalid commission amounts`);
    
    const fixedOrders = [];
    
    for (const order of invalidOrders) {
      try {
        // Set commission amount to €400
        order.commission.amount = 40000;
        order.commission.status = order.status === 'completed' ? 'approved' : 'pending';
        
        await order.save();
        
        fixedOrders.push({
          orderId: order._id,
          clientType: order.clientType,
          status: order.status,
          commissionSet: '€400'
        });
        
        console.log(`✅ Fixed order ${order._id}: Set commission to €400`);
        
        // If order is completed, also create CommissionTransaction
        if (order.status === 'completed' && order.referralInfo.referredBy) {
          const CommissionTransaction = require('../model/CommissionTransaction');
          
          await CommissionTransaction.create({
            partner: order.referralInfo.referredBy,
            order: order._id,
            amount: 40000,
            type: 'EARNED',
            status: 'COMPLETED',
            description: `€400 commission for order #${order._id}`,
            metadata: {
              orderAmount: order.finalPrice,
              orderDate: order.createdAt
            }
          });
          
          console.log(`✅ Created commission transaction for order ${order._id}`);
        }
        
      } catch (orderError) {
        console.error(`❌ Failed to fix order ${order._id}:`, orderError.message);
      }
    }
    
    res.json({
      success: true,
      message: `Fixed ${fixedOrders.length} orders with invalid commissions`,
      fixedOrders,
      totalFound: invalidOrders.length
    });
    
  } catch (error) {
    console.error('❌ Commission fix process failed:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

// Fix missing commissions for existing orders
exports.fixMissingCommissions = async (req, res) => {
  try {
    const { partnerId } = req.params;
    
    console.log(`🔧 Fixing missing commissions for partner: ${partnerId}`);
    
    // Find all completed referral orders for this partner
    const orders = await Order.find({
      'referralInfo.referredBy': partnerId,
      status: 'completed',
      clientType: 'REFERRAL',
      $or: [
        { 'commission.amount': { $ne: 40000 } },
        { 'commission.amount': { $exists: false } },
        { 'referralInfo.commissionProcessed': false },
        { 'referralInfo.commissionProcessed': { $exists: false } }
      ]
    });
    
    console.log(`📋 Found ${orders.length} orders with missing commissions`);
    
    const partner = await Partner.findById(partnerId);
    if (!partner) {
      return res.status(404).json({
        success: false,
        error: 'Partner not found'
      });
    }
    
    const results = [];
    let totalCommissionAdded = 0;
    
    for (const order of orders) {
      try {
        const commissionAmount = 40000; // €400 in cents
        
        // Update order
        order.commission.amount = commissionAmount;
        order.commission.status = 'approved';
        order.referralInfo.commissionProcessed = true;
        await order.save();
        
        // Update partner
        partner.commission.earned = (partner.commission.earned || 0) + commissionAmount;
        partner.commission.available = (partner.commission.available || 0) + commissionAmount;
        
        // Update referral stats
        partner.referrals.totalOrders = (partner.referrals.totalOrders || 0) + 1;
        partner.referrals.totalSales = (partner.referrals.totalSales || 0) + (order.finalPrice || 0);
        
        if (order.client && !partner.referrals.clients?.includes(order.client._id)) {
          partner.referrals.clients = partner.referrals.clients || [];
          partner.referrals.clients.push(order.client._id);
          partner.referrals.totalClients = (partner.referrals.totalClients || 0) + 1;
        }
        
        if (!partner.referrals.orders?.includes(order._id)) {
          partner.referrals.orders = partner.referrals.orders || [];
          partner.referrals.orders.push(order._id);
        }
        
        // Create commission transaction if it doesn't exist
        const CommissionTransaction = require('../model/CommissionTransaction');
        const existingTransaction = await CommissionTransaction.findOne({
          order: order._id,
          partner: partnerId
        });
        
        if (!existingTransaction) {
          await CommissionTransaction.create({
            partner: partnerId,
            order: order._id,
            amount: commissionAmount,
            type: 'EARNED',
            status: 'COMPLETED',
            description: `€400 commission for referral order #${order._id}`,
            metadata: {
              fixed: true,
              fixedAt: new Date(),
              orderAmount: order.finalPrice
            }
          });
        }
        
        totalCommissionAdded += commissionAmount;
        
        results.push({
          orderId: order._id,
          status: 'fixed',
          clientEmail: order.customerDetails?.email,
          orderAmount: order.finalPrice,
          commissionAdded: commissionAmount
        });
        
        console.log(`✅ Fixed order ${order._id} - added €400 commission`);
        
      } catch (error) {
        console.error(`❌ Failed to fix order ${order._id}:`, error.message);
        results.push({
          orderId: order._id,
          status: 'failed',
          error: error.message
        });
      }
    }
    
    // Save partner updates
    await partner.save();
    
    console.log(`✅ Fixed ${results.filter(r => r.status === 'fixed').length} orders`);
    console.log(`💰 Total commission added: €${totalCommissionAdded / 100}`);
    
    res.json({
      success: true,
      message: `Fixed ${results.filter(r => r.status === 'fixed').length} orders`,
      totalCommissionAdded: totalCommissionAdded / 100,
      partnerUpdated: {
        commissionEarned: partner.commission.earned,
        commissionAvailable: partner.commission.available,
        totalClients: partner.referrals.totalClients || 0,
        totalOrders: partner.referrals.totalOrders || 0,
        totalSales: partner.referrals.totalSales || 0
      },
      results
    });
    
  } catch (error) {
    console.error('Fix script error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

// 🔥 NEW: Test Stripe Connect Flow
exports.testStripeConnectFlow = async (req, res) => {
  try {
    const { partnerId } = req.params;
    
    const partner = await Partner.findById(partnerId);
    if (!partner) {
      return res.status(404).json({ error: 'Partner not found' });
    }
    
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    
    // Check if partner has Stripe Connect
    const hasStripeConnect = partner.stripeConnect?.accountId && 
                            partner.stripeConnect.chargesEnabled;
    
    // Create test checkout session with destination charge
    const sessionConfig = {
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'eur',
          product_data: {
            name: 'STARTER Plan Test',
            description: 'Test order for Stripe Connect'
          },
          unit_amount: 390000, // €3,900
        },
        quantity: 1,
      }],
      mode: 'payment',
      success_url: `${process.env.FRONTEND_URL}/test-success`,
      cancel_url: `${process.env.FRONTEND_URL}/test-cancel`,
      metadata: {
        test: 'true',
        partnerId: partner._id.toString(),
        commissionAmount: '40000'
      }
    };
    
    // Add destination charge if partner has Stripe Connect
    if (hasStripeConnect) {
      const platformFee = 390000 - 40000; // €3,500 platform fee
      sessionConfig.payment_intent_data = {
        application_fee_amount: platformFee,
        transfer_data: {
          destination: partner.stripeConnect.accountId,
        },
      };
    }
    
    const session = await stripe.checkout.sessions.create(sessionConfig);
    
    res.json({
      success: true,
      partner: {
        name: partner.name,
        email: partner.email,
        hasStripeConnect: hasStripeConnect,
        stripeAccountId: partner.stripeConnect?.accountId,
        chargesEnabled: partner.stripeConnect?.chargesEnabled
      },
      checkout: {
        url: session.url,
        hasDestinationCharge: hasStripeConnect,
        platformFee: hasStripeConnect ? '€3,500' : 'N/A',
        partnerCommission: hasStripeConnect ? '€400 (instant)' : '€400 (manual)'
      }
    });
    
  } catch (error) {
    console.error('Test flow error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Add this function to orderController.js
exports.linkOrdersToPartners = async (req, res) => {
  try {
    console.log('🔗 Linking existing orders to partners...');
    
    // Find all orders with clientType REFERRAL but missing partner link
    const orders = await Order.find({
      clientType: 'REFERRAL',
      $or: [
        { 'referralInfo.referredBy': { $exists: false } },
        { 'referralInfo.referredBy': null }
      ]
    }).populate('client');
    
    console.log(`📋 Found ${orders.length} orders without partner link`);
    
    const results = [];
    
    for (const order of orders) {
      try {
        const client = order.client;
        if (client && client.referredBy) {
          const partner = await Partner.findById(client.referredBy);
          
          if (partner) {
            // Update order with partner info
            order.referralInfo = {
              referralCode: partner.referralCode,
              referredBy: partner._id,
              partnerName: partner.name,
              partnerEmail: partner.email,
              commissionProcessed: false
            };
            
            // Set commission
            order.commission.amount = 40000; // €400 in cents
            order.commission.status = order.status === 'completed' ? 'approved' : 'pending';
            
            await order.save();
            
            // Update partner stats if order is completed
            if (order.status === 'completed') {
              partner.commission.earned = (partner.commission.earned || 0) + 40000;
              partner.commission.available = (partner.commission.available || 0) + 40000;
              
              // Add to partner's orders array
              partner.referrals.orders = partner.referrals.orders || [];
              if (!partner.referrals.orders.includes(order._id)) {
                partner.referrals.orders.push(order._id);
              }
              
              partner.referrals.totalOrders = (partner.referrals.totalOrders || 0) + 1;
              partner.referrals.totalSales = (partner.referrals.totalSales || 0) + (order.finalPrice || 0);
              
              await partner.save();
            }
            
            results.push({
              orderId: order._id,
              clientEmail: order.customerDetails?.email,
              partnerName: partner.name,
              status: 'linked',
              commissionSet: '€400'
            });
            
            console.log(`✅ Linked order ${order._id} to partner ${partner.name}`);
          }
        }
      } catch (orderError) {
        console.error(`❌ Failed to link order ${order._id}:`, orderError.message);
        results.push({
          orderId: order._id,
          status: 'failed',
          error: orderError.message
        });
      }
    }
    
    res.json({
      success: true,
      message: `Linked ${results.filter(r => r.status === 'linked').length} orders to partners`,
      results
    });
    
  } catch (error) {
    console.error('Link orders error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

// Add this function to fix existing data
exports.fixPendingOrdersSales = async (req, res) => {
  try {
    console.log('🔧 Fixing pending orders sales calculation...');
    
    // Get all partners
    const partners = await Partner.find({});
    
    let fixedPartners = 0;
    let totalCorrectedSales = 0;
    
    for (const partner of partners) {
      try {
        // Get all orders for this partner
        const orders = await Order.find({
          'referralInfo.referredBy': partner._id
        }).select('status finalPrice originalPrice');
        
        // Calculate correct total sales (only completed orders)
        const correctSales = orders.reduce((sum, order) => {
          if (order.status === 'completed') {
            return sum + (order.finalPrice || order.originalPrice || 0);
          }
          return sum;
        }, 0);
        
        // Get current sales from partner
        const currentSales = partner.referrals.totalSales || 0;
        
        // If there's a discrepancy, fix it
        if (currentSales !== correctSales) {
          console.log(`📊 Partner ${partner.name}:`);
          console.log(`   Current sales: €${currentSales/100}`);
          console.log(`   Correct sales: €${correctSales/100}`);
          console.log(`   Difference: €${(currentSales - correctSales)/100}`);
          
          // Update partner
          partner.referrals.totalSales = correctSales;
          await partner.save();
          
          fixedPartners++;
          totalCorrectedSales += Math.abs(currentSales - correctSales);
          
          console.log(`✅ Fixed partner ${partner.name}'s sales calculation`);
        }
      } catch (partnerError) {
        console.error(`❌ Error fixing partner ${partner._id}:`, partnerError.message);
      }
    }
    
    res.json({
      success: true,
      message: `Fixed sales calculation for ${fixedPartners} partners`,
      totalCorrectedAmount: totalCorrectedSales / 100,
      partnersFixed: fixedPartners
    });
    
  } catch (error) {
    console.error('Fix sales error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};