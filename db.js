const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    // Use MONGODB_URI if available, fallback to DB_URL
    const mongoURI = process.env.MONGODB_URI || process.env.DB_URL;
    
    if (!mongoURI) {
      throw new Error('No MongoDB connection string found. Please set MONGODB_URI or DB_URL in .env file');
    }

    console.log(`🔗 Attempting MongoDB connection...`);
    console.log(`Host: ${mongoURI.split('@')[1]?.split('/')[0] || 'Unknown'}`);

    // Enhanced connection options for DNS issues
    const connectionOptions = {
      serverSelectionTimeoutMS: 15000, // Increased to 15 seconds
      socketTimeoutMS: 45000,
      connectTimeoutMS: 15000,
      maxPoolSize: 10,
      retryWrites: true,
      w: 'majority',
      // Force IPv4 to avoid IPv6 DNS issues
      family: 4,
    };

    await mongoose.connect(mongoURI, connectionOptions);

    console.log(`✅ MongoDB Connected successfully to: ${mongoose.connection.name}`);
    
    // Connection event listeners
    mongoose.connection.on('connected', () => {
      console.log('Mongoose connected to DB');
    });
    
    mongoose.connection.on('error', (err) => {
      console.error(`Mongoose connection error: ${err.message}`);
    });
    
    mongoose.connection.on('disconnected', () => {
      console.warn('⚠️ Mongoose disconnected from DB');
    });

  } catch (error) {
    console.error(`❌ MongoDB Connection Error: ${error.message}`);
    
    // Special handling for DNS timeout
    if (error.message.includes('queryTxt ETIMEOUT') || error.message.includes('ENOTFOUND')) {
      console.log('\n💡 DNS Resolution Failed! Troubleshooting Steps:');
      console.log('1. Check your internet connection');
      console.log('2. Try with mobile hotspot (bypass network restrictions)');
      console.log('3. Change DNS to 8.8.8.8 (Google DNS)');
      console.log('4. Temporarily disable firewall/antivirus');
      console.log('5. Contact network administrator');
      
      console.log('\n🔄 Attempting fallback connection method...');
      await tryAlternativeConnection();
    } else {
      console.error('Full error stack:', error.stack);
      
      // Don't exit immediately, try to continue
      console.log('⚠️ Application will run without database connection');
      console.log('Some features may not be available');
    }
    // Don't call process.exit(1) - let the app continue without DB
  }
};

// Alternative connection method
async function tryAlternativeConnection() {
  try {
    const mongoURI = process.env.MONGODB_URI || process.env.DB_URL;
    
    if (!mongoURI) return;
    
    // Try without SRV record
    const directURI = mongoURI
      .replace('mongodb+srv://', 'mongodb://')
      .replace('user-management-cluster.zkw9a.mongodb.net', 
               'user-management-cluster-shard-00-00.zkw9a.mongodb.net:27017,' +
               'user-management-cluster-shard-00-01.zkw9a.mongodb.net:27017,' +
               'user-management-cluster-shard-00-02.zkw9a.mongodb.net:27017') +
      '&ssl=true&replicaSet=atlas-zkw9a-shard-0&authSource=admin';
    
    console.log('🔄 Trying direct connection (without SRV)...');
    
    await mongoose.connect(directURI, {
      serverSelectionTimeoutMS: 10000,
      family: 4,
    });
    
    console.log('✅ Connected via direct method!');
    
  } catch (fallbackError) {
    console.error('❌ Fallback connection also failed:', fallbackError.message);
    console.log('\n💡 Try these immediate solutions:');
    console.log('A. Use local MongoDB:');
    console.log('   - Install: https://www.mongodb.com/try/download/community');
    console.log('   - Update .env: MONGODB_URI=mongodb://localhost:27017/ouvrir-societe');
    console.log('B. Or use in-memory MongoDB: npm install mongodb-memory-server');
  }
}

// Check connection status
const isConnected = () => {
  return mongoose.connection.readyState === 1;
};

// Graceful shutdown
process.on('SIGINT', async () => {
  if (mongoose.connection.readyState === 1) {
    await mongoose.connection.close();
    console.log('Mongoose connection closed through app termination');
  }
  process.exit(0);
});

module.exports = { connectDB, isConnected };