// scripts/fixCommissions.js
const mongoose = require('mongoose');
require('dotenv').config();

async function fixPartnerCommissions() {
  try {
    console.log('🔄 Connecting to database...');
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/your-db-name');
    console.log('✅ Database connected');
    
    const Partner = require('../model/Partner');
    const Order = require('../model/Order');
    const CommissionTransaction = require('../model/CommissionTransaction');
    
    // Get all partners
    const partners = await Partner.find({});
    console.log(`📊 Found ${partners.length} partners to process`);
    
    for (const partner of partners) {
      console.log(`\n--- Processing partner: ${partner.email} (${partner._id}) ---`);
      
      // Get all completed referred orders for this partner
      const orders = await Order.find({
        referredBy: partner._id,
        status: 'completed',
        source: 'REFERRAL'
      });
      
      console.log(`   Found ${orders.length} completed referred orders`);
      
      // Recalculate commissions from scratch
      let totalCommission = 0;
      let totalSales = 0;
      
      for (const order of orders) {
        const commissionRate = partner.commissionRate || 10;
        const commission = Math.round(order.originalPrice * (commissionRate / 100));
        totalCommission += commission;
        totalSales += order.originalPrice;
        
        // Mark order as processed if not already
        if (!order.isCommissionProcessed) {
          order.isCommissionProcessed = true;
          order.commissionProcessedAt = new Date();
          order.partnerCommission = commission;
          await order.save();
          console.log(`   ✅ Order ${order._id}: Commission ${commission} cents`);
        }
      }
      
      // Calculate what should be available (earned - paid)
      const currentPaid = partner.commissionPaid || 0;
      const available = totalCommission - currentPaid;
      
      // Update partner with correct values
      partner.commissionEarned = totalCommission;
      partner.availableCommission = available > 0 ? available : 0;
      partner.totalReferralSales = totalSales;
      
      // Ensure all referred orders are in the array
      const orderIds = orders.map(o => o._id);
      partner.ordersReferred = [...new Set([...partner.ordersReferred.map(id => id.toString()), ...orderIds.map(id => id.toString())])];
      
      await partner.save();
      
      console.log(`   ✅ Partner updated:`);
      console.log(`      Earned: ${totalCommission} cents`);
      console.log(`      Paid: ${currentPaid} cents`);
      console.log(`      Available: ${available} cents`);
      console.log(`      Sales: ${totalSales} cents`);
      
      // Create commission transaction records for existing commissions
      const existingEarnings = await CommissionTransaction.find({
        partner: partner._id,
        type: 'EARNED'
      });
      
      if (existingEarnings.length === 0 && totalCommission > 0) {
        console.log(`   Creating commission transaction records...`);
        
        // Create a summary transaction for existing earnings
        await CommissionTransaction.create({
          partner: partner._id,
          amount: totalCommission,
          type: 'EARNED',
          status: 'COMPLETED',
          description: 'Initial commission calculation from existing orders',
          balanceBefore: 0,
          balanceAfter: totalCommission,
          availableBefore: 0,
          availableAfter: available > 0 ? available : 0,
          metadata: {
            ordersCount: orders.length,
            fixScript: true,
            timestamp: new Date()
          }
        });
        
        console.log(`   ✅ Created commission transaction`);
      }
    }
    
    console.log('\n🎉 Commission fix complete!');
    console.log(`Processed ${partners.length} partners`);
    
  } catch (error) {
    console.error('❌ Error fixing commissions:', error);
  } finally {
    await mongoose.disconnect();
    console.log('Database connection closed');
    process.exit(0);
  }
}

// Run the fix
fixPartnerCommissions();