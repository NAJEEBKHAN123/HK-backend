// config/db.js
const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.DB_URL, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    console.log(`✅ MongoDB Connected successfully`);
  } catch (error) {
    console.error(`❌ Error in DB connection`);
    process.exit(1); // Exit with failure
  }
};

module.exports = connectDB;
