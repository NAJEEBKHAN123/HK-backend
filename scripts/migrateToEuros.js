const mongoose = require('mongoose');
const path = require('path');
const dotenv = require('dotenv');

// Load environment variables from the correct location
dotenv.config({ path: path.join(__dirname, '..', '.env') });

async function migrateToEuros() {
  try {
    // Check if we have the MongoDB URI
    const mongoUri = process.env.MONGODB_URI || process.env.MONGODB_URL || 'mongodb://localhost:27017/ouvrirsociete';
    
    console.log('🔗 Connecting to MongoDB...');
    console.log('📝 Connection string:', mongoUri.replace(/\/\/[^@]+@/, '//***:***@'));
    
    await mongoose.connect(mongoUri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 5000,
    });
    
    console.log('✅ Connected to MongoDB');
    
    const db = mongoose.connection.db;
    
    // Check collections first
    const collections = await db.listCollections().toArray();
    console.log('📋 Available collections:', collections.map(c => c.name));
    
    // Get current data before migration for reference
    console.log('\n📊 Checking current commission data...');
    
    const partners = await db.collection('partners').find({}).limit(5).toArray();
    console.log('\n📈 Sample Partner Data BEFORE Migration:');
    partners.forEach(partner => {
      console.log(`\nPartner: ${partner.name || partner.email}`);
      console.log(`  Earned: ${partner.commissionEarned || 0} (€${(partner.commissionEarned || 0) / 100})`);
      console.log(`  Available: ${partner.availableCommission || 0} (€${(partner.availableCommission || 0) / 100})`);
    });
    
    // Ask for confirmation
    console.log('\n⚠️  WARNING: This will convert all amounts from CENTS to EUROS');
    console.log('   Example: 980 cents → €9.80');
    console.log('\nContinue? (y/n)');
    
    // Wait for user input
    process.stdin.setEncoding('utf8');
    const waitForInput = new Promise((resolve) => {
      process.stdin.once('data', (data) => {
        resolve(data.toString().trim().toLowerCase());
      });
    });
    
    const answer = await waitForInput;
    
    if (answer !== 'y') {
      console.log('❌ Migration cancelled by user');
      await mongoose.disconnect();
      process.exit(0);
    }
    
    // Start migration
    console.log('\n🔄 Starting migration...');
    
    // 1. Update partners collection
    console.log('\n1️⃣  Migrating partners collection...');
    const partnerResult = await db.collection('partners').updateMany({}, [
      {
        $set: {
          commissionEarned: { $divide: [{ $ifNull: ["$commissionEarned", 0] }, 100] },
          commissionPaid: { $divide: [{ $ifNull: ["$commissionPaid", 0] }, 100] },
          availableCommission: { $divide: [{ $ifNull: ["$availableCommission", 0] }, 100] },
          commissionOnHold: { $divide: [{ $ifNull: ["$commissionOnHold", 0] }, 100] },
          totalReferralSales: { $divide: [{ $ifNull: ["$totalReferralSales", 0] }, 100] }
        }
      }
    ]);
    console.log(`   ✅ Updated ${partnerResult.modifiedCount} partners`);
    
    // 2. Update commissiontransactions collection
    console.log('\n2️⃣  Migrating commission transactions collection...');
    const transactionResult = await db.collection('commissiontransactions').updateMany({}, [
      {
        $set: {
          amount: { $divide: [{ $ifNull: ["$amount", 0] }, 100] },
          balanceBefore: { $divide: [{ $ifNull: ["$balanceBefore", 0] }, 100] },
          balanceAfter: { $divide: [{ $ifNull: ["$balanceAfter", 0] }, 100] },
          availableBefore: { $divide: [{ $ifNull: ["$availableBefore", 0] }, 100] },
          availableAfter: { $divide: [{ $ifNull: ["$availableAfter", 0] }, 100] },
          onHoldBefore: { $divide: [{ $ifNull: ["$onHoldBefore", 0] }, 100] },
          onHoldAfter: { $divide: [{ $ifNull: ["$onHoldAfter", 0] }, 100] }
        }
      }
    ]);
    console.log(`   ✅ Updated ${transactionResult.modifiedCount} commission transactions`);
    
    // 3. Update orders collection
    console.log('\n3️⃣  Migrating orders collection...');
    const orderResult = await db.collection('orders').updateMany({}, [
      {
        $set: {
          originalPrice: { $divide: [{ $ifNull: ["$originalPrice", 0] }, 100] },
          finalPrice: { $divide: [{ $ifNull: ["$finalPrice", 0] }, 100] },
          partnerCommission: { $divide: [{ $ifNull: ["$partnerCommission", 0] }, 100] }
        }
      }
    ]);
    console.log(`   ✅ Updated ${orderResult.modifiedCount} orders`);
    
    // Verify the migration
    console.log('\n✅ Migration completed successfully!');
    
    console.log('\n📊 Sample Partner Data AFTER Migration:');
    const updatedPartners = await db.collection('partners').find({}).limit(5).toArray();
    updatedPartners.forEach(partner => {
      console.log(`\nPartner: ${partner.name || partner.email}`);
      console.log(`  Earned: €${partner.commissionEarned || 0}`);
      console.log(`  Available: €${partner.availableCommission || 0}`);
    });
    
    console.log('\n📈 Migration Summary:');
    console.log(`   - Partners: ${partnerResult.modifiedCount} updated`);
    console.log(`   - Transactions: ${transactionResult.modifiedCount} updated`);
    console.log(`   - Orders: ${orderResult.modifiedCount} updated`);
    console.log('\n🎉 All amounts have been converted from cents to euros!');
    console.log('\n⚠️  IMPORTANT: Make sure to update your code files with the new euros-based code provided.');
    
  } catch (error) {
    console.error('\n❌ Migration error:', error.message);
    console.error('Stack:', error.stack);
  } finally {
    await mongoose.disconnect();
    console.log('\n🔒 Disconnected from MongoDB');
    process.exit(0);
  }
}

migrateToEuros();