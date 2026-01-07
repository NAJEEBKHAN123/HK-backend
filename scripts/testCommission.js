const mongoose = require('mongoose');

async function testCommission() {
  try {
    // Connect to database - Use your actual MongoDB URI
    const MONGODB_URI = 'mongodb://localhost:27017/ouvrirsociete';
    console.log('🔗 Connecting to MongoDB...');
    
    await mongoose.connect(MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    
    console.log('✅ Connected to database');
    
    // Import models
    const Partner = require('../model/Partner');
    const Order = require('../model/Order');
    const CommissionTransaction = require('../model/CommissionTransaction');
    const CommissionService = require('../services/commissionService');
    
    console.log('🧪 Starting commission system test...');
    
    // First, clean up any existing test data
    const testEmail = 'test-commission@partner.com';
    await Partner.deleteOne({ email: testEmail });
    
    // Create a test partner
    const partner = await Partner.create({
      name: 'Test Commission Partner',
      email: testEmail,
      password: 'password123',
      status: 'active'
    });
    
    console.log('✅ Created partner:', partner.email);
    console.log('🔗 Partner referral code:', partner.referralCode);
    
    // Create a test client for the order
    const Client = require('../model/Client');
    const client = await Client.create({
      name: 'Test Client',
      email: 'client-test@example.com',
      source: 'referral'
    });
    
    console.log('✅ Created client:', client.email);
    
    // Create a test order with referral
    const order = await Order.create({
      plan: 'PREMIUM',
      customerDetails: {
        fullName: 'Test Customer',
        email: 'customer@test.com',
        phone: '1234567890',
        address: 'Test Address',
        birthday: new Date('1990-01-01'),
        idFrontImage: 'test-front.jpg',
        idBackImage: 'test-back.jpg'
      },
      originalPrice: 100000, // €1000 in cents
      finalPrice: 100000, // €1000 in cents
      clientType: 'REFERRAL',
      referralInfo: {
        referralCode: partner.referralCode,
        referredBy: partner._id,
        partnerName: partner.name,
        partnerEmail: partner.email,
        commissionProcessed: false
      },
      stripe: {
        paymentStatus: 'succeeded',
        amountPaid: 100000,
        currency: 'eur'
      },
      client: client._id,
      status: 'completed'
    });
    
    console.log('✅ Created order:', order._id);
    console.log('💰 Order amount:', `€${(order.finalPrice / 100).toFixed(2)}`);
    console.log('🎯 Commission amount: €400');
    
    // Test commission processing
    console.log('\n💰 Processing commission...');
    const commission = await CommissionService.earnCommission(order._id);
    
    if (commission) {
      console.log('✅ Commission processed successfully!');
      console.log('📊 Commission transaction:', commission._id);
      console.log('💰 Commission amount:', `€${(commission.amount / 100).toFixed(2)}`);
      
      // Check partner balance
      const updatedPartner = await Partner.findById(partner._id);
      console.log('\n💰 Partner commission balance:');
      console.log('- Earned:', `€${(updatedPartner.commission.earned / 100).toFixed(2)}`);
      console.log('- Available:', `€${(updatedPartner.commission.available / 100).toFixed(2)}`);
      console.log('- On Hold:', `€${(updatedPartner.commission.onHold / 100).fixed(2)}`);
      
      // Test get summary
      console.log('\n📈 Getting partner summary...');
      const summary = await CommissionService.getPartnerSummary(partner._id);
      console.log('✅ Summary retrieved:');
      console.log('- Total earned:', `€${summary.summary.earnedEuros}`);
      console.log('- Available:', `€${summary.summary.availableEuros}`);
      console.log('- Withdrawable:', `€${summary.summary.withdrawableEuros}`);
      
      // Test payout if enough funds
      if (updatedPartner.commission.available >= 10000) { // €100 minimum
        console.log('\n💸 Testing payout...');
        const payoutAmount = 100; // €100
        const payout = await CommissionService.processPayout(
          partner._id,
          payoutAmount,
          'test-admin-id',
          { method: 'BANK_TRANSFER', notes: 'Test commission payout' }
        );
        
        console.log('✅ Payout processed successfully!');
        console.log('💰 Payout amount:', `€${payoutAmount}`);
        console.log('📊 Payout transaction:', payout.transaction._id);
        
        // Final check
        const finalPartner = await Partner.findById(partner._id);
        console.log('\n💰 Final partner balance:');
        console.log('- Total earned:', `€${(finalPartner.commission.earned / 100).toFixed(2)}`);
        console.log('- Paid out:', `€${(finalPartner.commission.paid / 100).toFixed(2)}`);
        console.log('- Available now:', `€${(finalPartner.commission.available / 100).toFixed(2)}`);
      } else {
        console.log('\n⚠️  Not enough funds for payout test');
      }
      
      // Test getting transactions
      console.log('\n📋 Getting commission transactions...');
      const transactions = await CommissionService.getPartnerTransactions(partner._id, { limit: 10 });
      console.log(`✅ Found ${transactions.length} transactions`);
      
      transactions.forEach((t, i) => {
        console.log(`${i + 1}. ${t.type}: ${t.displayAmount} - ${t.description}`);
      });
    }
    
    // Test commission adjustment
    console.log('\n🔄 Testing commission adjustment...');
    try {
      const adjustment = await CommissionService.adjustCommission(
        partner._id,
        {
          amount: 50, // €50
          type: 'ADD',
          reason: 'Test bonus',
          adminNotes: 'Test adjustment',
          adminId: 'test-admin-id'
        }
      );
      console.log('✅ Adjustment successful:', `Added €50`);
    } catch (adjError) {
      console.log('⚠️  Adjustment test skipped:', adjError.message);
    }
    
    console.log('\n🧪 All tests completed!');
    
    // Show final summary
    console.log('\n📊 FINAL TEST SUMMARY:');
    console.log('=====================');
    const finalPartner = await Partner.findById(partner._id);
    console.log('Partner:', finalPartner.email);
    console.log('Referral Code:', finalPartner.referralCode);
    console.log('Commission Earned:', `€${(finalPartner.commission.earned / 100).toFixed(2)}`);
    console.log('Commission Paid:', `€${(finalPartner.commission.paid / 100).toFixed(2)}`);
    console.log('Available Balance:', `€${(finalPartner.commission.available / 100).toFixed(2)}`);
    
    const transactionCount = await CommissionTransaction.countDocuments({ partner: partner._id });
    console.log('Total Transactions:', transactionCount);
    
    const orderCheck = await Order.findById(order._id);
    console.log('Order commission processed:', orderCheck.referralInfo.commissionProcessed);
    console.log('Order commission status:', orderCheck.commission.status);
    
    // Optional: Cleanup test data
    console.log('\n🧹 Cleaning up test data...');
    const deleteTestData = false; // Set to true to delete test data
    
    if (deleteTestData) {
      await Partner.deleteOne({ _id: partner._id });
      await Order.deleteOne({ _id: order._id });
      await Client.deleteOne({ _id: client._id });
      await CommissionTransaction.deleteMany({ partner: partner._id });
      console.log('✅ Test data cleaned up');
    } else {
      console.log('⚠️  Test data preserved for inspection');
      console.log('Partner ID:', partner._id);
      console.log('Order ID:', order._id);
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error('Stack:', error.stack);
  } finally {
    await mongoose.disconnect();
    console.log('\n🔌 Database connection closed');
    process.exit(0);
  }
}

// Run the test
testCommission();