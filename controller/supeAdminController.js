// controller/supeAdminController.js
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const Admin = require("../model/adminModel");

exports.loginAdmin = async (req, res) => {
  console.log('🔐 Admin login attempt for:', req.body.email);

  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ 
        success: false,
        message: "Email and password are required"
      });
    }

    // Normalize email
    const normalizedEmail = email.toLowerCase().trim();

    const admin = await Admin.findOne({ email: normalizedEmail });
    
    if (!admin) {
      console.log('❌ Admin not found:', normalizedEmail);
      return res.status(404).json({ 
        success: false,
        message: "Admin not found"
      });
    }

    // Check password
    const isPasswordValid = await bcrypt.compare(password, admin.password);
    if (!isPasswordValid) {
      console.log('❌ Invalid password for admin:', admin.email);
      return res.status(401).json({ 
        success: false,
        message: "Invalid email or password"
      });
    }

    // CRITICAL: Create token with role: 'admin'
    const tokenPayload = {
      id: admin._id,
      role: "admin",  // MUST BE 'admin'
      email: admin.email,
      name: admin.name
    };
    
    console.log('📝 Creating token with payload:', tokenPayload);

    const token = jwt.sign(
      tokenPayload,
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    console.log('✅ Admin login successful:', {
      id: admin._id,
      email: admin.email,
      tokenCreated: true
    });

    res.status(200).json({
      success: true,
      message: "Login successful",
      token,
      admin: { 
        id: admin._id,
        name: admin.name, 
        email: admin.email,
        role: 'admin'
      }
    });
  } catch (err) {
    console.error('❌ Admin login error:', err);
    res.status(500).json({ 
      success: false,
      message: "Server error during admin login",
      error: err.message
    });
  }
};

exports.verifyAdmin = async (req, res) => {
  try {
    console.log('✅ Admin verification controller called');
    
    if (!req.admin) {
      console.log('❌ No admin in request object');
      return res.status(401).json({
        success: false,
        message: "Not authenticated as admin"
      });
    }

    res.status(200).json({
      success: true,
      message: 'Admin authenticated successfully',
      admin: {
        id: req.admin._id,
        name: req.admin.name,
        email: req.admin.email,
        role: 'admin'
      }
    });
  } catch (error) {
    console.error('❌ Admin verification error:', error);
    res.status(500).json({ 
      success: false,
      message: "Error verifying admin",
      error: error.message 
    });
  }
};

exports.getAdminData = async (req, res) => {
  try {
    const adminId = req.params.id;
    
    if (adminId !== req.admin._id.toString()) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to access this data"
      });
    }

    const admin = await Admin.findById(adminId).select("-password");
    
    if (!admin) {
      return res.status(404).json({
        success: false,
        message: "Admin not found"
      });
    }

    res.status(200).json({
      success: true,
      data: admin
    });
  } catch (error) {
    console.error('❌ Get admin data error:', error);
    res.status(500).json({
      success: false,
      message: "Error fetching admin data"
    });
  }
};