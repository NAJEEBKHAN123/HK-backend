require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const Admin = require("../model/userModel");

// ✅ Make sure your .env file has DB_URL set, or you can replace it directly with your connection string
mongoose.connect(process.env.DB_URL, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

const addAdmin = async () => {
  try {
    const hashedPassword = await bcrypt.hash("admin123", 10); // ✅ password as string

    const newAdmin = new Admin({
      name: "Najeeb",
      email: "admin@example.com",
      password: hashedPassword,
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
