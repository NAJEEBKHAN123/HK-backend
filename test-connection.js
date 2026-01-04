// test-connection.js
require('dotenv').config();
const dns = require('dns');
const mongoose = require('mongoose');

console.log('🔍 Testing MongoDB Connection\n');

// Get connection string
const mongoURI = process.env.MONGODB_URI || process.env.DB_URL;
console.log('1. Connection string found:', !!mongoURI);

if (mongoURI) {
  const hostname = mongoURI.match(/@([^/]+)/)?.[1];
  console.log('2. Hostname to connect:', hostname);
  
  // Test DNS
  console.log('3. Testing DNS resolution...');
  dns.lookup(hostname, (err, address) => {
    if (err) {
      console.error('❌ DNS failed:', err.message);
      console.log('\n💡 This is a DNS/network issue.');
      console.log('Run: nslookup', hostname);
    } else {
      console.log('✅ DNS resolved to:', address);
      
      // Test connection
      console.log('4. Testing MongoDB connection...');
      mongoose.connect(mongoURI, {
        serverSelectionTimeoutMS: 10000,
        family: 4,
      })
      .then(() => {
        console.log('✅ MongoDB Connected!');
        process.exit(0);
      })
      .catch(err => {
        console.error('❌ Connection failed:', err.message);
        console.log('\n💡 Your credentials/IP may not be whitelisted');
        console.log('Go to MongoDB Atlas → Network Access → Add IP');
        process.exit(1);
      });
    }
  });
}