// scripts/checkPartner.js
const mongoose = require('mongoose');
const path = require('path');

// Load environment variables from the root .env file
require('dotenv').config({ path: path.join(__dirname, '../.env') });

async function checkPartner() {
  try {
    console.log('🔍 Checking partner data...');
    console.log('MONGODB_URI from env:', process.env.MONGODB_URI ? 'Loaded' : 'NOT LOADED');
    
    if (!process.env.MONGODB_URI) {
      console.error('❌ MONGODB_URI not found in environment variables');
      console.log('Current working directory:', process.cwd());
      console.log('Trying to load .env from:', path.join(__dirname, '../.env'));
      return;
    }
    
    console.log('🔄 Connecting to database...');
    
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 5000
    });
    
    console.log('✅ Database connected');
    
    // Load models
    const Partner = require('../model/Partner');
    const Order = require('../model/Order');
    
    // Check specific partner
    const partnerId = '69580ece54e5675f8e17c89c';
    const partner = await Partner.findById(partnerId);
    
    if (!partner) {
      console.log('❌ Partner not found');
      return;
    }
    
    console.log('\n📊 PARTNER DETAILS:');
    console.log('Name:', partner.name);
    console.log('Email:', partner.email);
    console.log('Referral Code:', partner.referralCode);
    console.log('Status:', partner.status);
    console.log('Commission Earned:', partner.commissionEarned, 'cents (€' + (partner.commissionEarned/100).toFixed(2) + ')');
    console.log('Commission Paid:', partner.commissionPaid, 'cents (€' + (partner.commissionPaid/100).toFixed(2) + ')');
    console.log('Available Commission:', partner.availableCommission, 'cents (€' + (partner.availableCommission/100).toFixed(2) + ')');
    console.log('Commission On Hold:', partner.commissionOnHold || 0, 'cents');
    console.log('Withdrawable:', (partner.availableCommission - (partner.commissionOnHold || 0)), 'cents');
    console.log('Commission Rate:', partner.commissionRate || 10, '%');
    console.log('Total Referral Sales:', partner.totalReferralSales || 0, 'cents');
    console.log('Referral Clicks:', partner.referralClicks || 0);
    console.log('Clients Referred:', partner.clientsReferred?.length || 0);
    console.log('Orders Referred:', partner.ordersReferred?.length || 0);
    
    // Check referred orders
    const orders = await Order.find({
      referredBy: partnerId,
      status: 'completed'
    });
    
    console.log('\n📦 COMPLETED REFERRED ORDERS:', orders.length);
    
    let totalOrderValue = 0;
    let totalCommission = 0;
    let processedCount = 0;
    let unprocessedCount = 0;
    
    if (orders.length > 0) {
      orders.forEach((order, index) => {
        const commission = Math.round(order.originalPrice * 0.10);
        totalOrderValue += order.originalPrice;
        totalCommission += commission;
        
        if (order.isCommissionProcessed) {
          processedCount++;
        } else {
          unprocessedCount++;
        }
        
        console.log(`\nOrder ${index + 1}:`);
        console.log('  ID:', order._id.toString().substring(0, 8) + '...');
        console.log('  Plan:', order.plan);
        console.log('  Original Price:', order.originalPrice, 'cents (€' + (order.originalPrice/100).toFixed(2) + ')');
        console.log('  Final Price:', order.finalPrice, 'cents (€' + (order.finalPrice/100).toFixed(2) + ')');
        console.log('  Commission (10%):', commission, 'cents (€' + (commission/100).toFixed(2) + ')');
        console.log('  Status:', order.status);
        console.log('  Source:', order.source);
        console.log('  Commission Processed:', order.isCommissionProcessed);
        console.log('  Created:', order.createdAt.toISOString().split('T')[0]);
      });
    } else {
      console.log('No completed referred orders found');
    }
    
    console.log('\n💰 COMMISSION ANALYSIS:');
    console.log('Total Order Value:', totalOrderValue, 'cents (€' + (totalOrderValue/100).toFixed(2) + ')');
    console.log('Total Commission Due (10%):', totalCommission, 'cents (€' + (totalCommission/100).toFixed(2) + ')');
    console.log('Current Commission Earned:', partner.commissionEarned, 'cents (€' + (partner.commissionEarned/100).toFixed(2) + ')');
    console.log('Difference:', totalCommission - partner.commissionEarned, 'cents');
    console.log('Processed Orders:', processedCount);
    console.log('Unprocessed Orders:', unprocessedCount);
    
    // Also check all orders with this referral code
    const allOrdersWithCode = await Order.find({
      referralCode: partner.referralCode
    });
    
    console.log('\n🔗 ALL ORDERS WITH REFERRAL CODE "' + partner.referralCode + '":', allOrdersWithCode.length);
    
    if (allOrdersWithCode.length > 0) {
      allOrdersWithCode.forEach((order, index) => {
        console.log(`\nOrder ${index + 1}:`);
        console.log('  Status:', order.status);
        console.log('  Source:', order.source);
        console.log('  Referred By:', order.referredBy ? 'Yes' : 'No');
        console.log('  Amount:', order.originalPrice, 'cents');
        console.log('  Created:', order.createdAt.toISOString().split('T')[0]);
      });
    }
    
    // Check commission transactions if model exists
    try {
      const CommissionTransaction = require('../model/CommissionTransaction');
      const transactions = await CommissionTransaction.find({
        partner: partnerId
      }).sort({ createdAt: -1 });
      
      console.log('\n💳 COMMISSION TRANSACTIONS:', transactions.length);
      
      if (transactions.length > 0) {
        transactions.forEach((tx, index) => {
          console.log(`\nTransaction ${index + 1}:`);
          console.log('  Type:', tx.type);
          console.log('  Amount:', tx.amount, 'cents (€' + (tx.amount/100).toFixed(2) + ')');
          console.log('  Description:', tx.description);
          console.log('  Status:', tx.status);
          console.log('  Date:', tx.createdAt.toISOString().split('T')[0]);
          console.log('  Balance After:', tx.balanceAfter, 'cents');
        });
      }
    } catch (error) {
      console.log('\n⚠️  CommissionTransaction model not available yet');
    }
    
    console.log('\n🎯 RECOMMENDATION:');
    console.log('Available Commission: €' + (partner.availableCommission/100).toFixed(2));
    console.log('Requested Payout: €' + (29200/100).toFixed(2));
    console.log('Shortfall: €' + ((29200 - partner.availableCommission)/100).toFixed(2));
    
    if (unprocessedCount > 0) {
      console.log('\n🚨 ACTION NEEDED:');
      console.log('Found', unprocessedCount, 'unprocessed orders with estimated commission: €' + (totalCommission/100).toFixed(2));
      console.log('Run the fixCommissions script to process these orders.');
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error('Stack:', error.stack);
  } finally {
    if (mongoose.connection.readyState === 1) {
      await mongoose.disconnect();
      console.log('\n🔌 Database disconnected');
    }
  }
}

// Run the check
checkPartner();