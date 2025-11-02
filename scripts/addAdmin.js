require("dotenv").config();
const mongoose = require("mongoose");
const Admin = require("../model/adminModel");

// Connect to MongoDB
mongoose.connect(process.env.DB_URL, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

const addAdmin = async () => {
  try {
    // Delete existing admin if any
    await Admin.deleteOne({ email: "l.martin@csqi.ro" });

    // Create new admin (password will be hashed automatically by schema)
    const newAdmin = new Admin({
      name: "Martin Ludovic",
      email: "l.martin@csqi.ro",
      password: "Ludovic2609!" // ❌ Do NOT hash manually
    });

    await newAdmin.save();
    console.log("✅ Admin added successfully!");
    mongoose.disconnect();
  } catch (error) {
    console.error("❌ Error adding admin:", error.message);
    mongoose.disconnect();
  }
};

addAdmin();
