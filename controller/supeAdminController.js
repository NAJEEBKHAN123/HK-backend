// controller/supeAdminController.js
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const Admin = require("../model/adminModel");

exports.loginAdmin = async (req, res) => {
  if (!req.body) {
    return res.status(400).json({ 
      success: false,
      message: "Request body is missing" 
    });
  }

  const { email, password } = req.body;
  console.log("🔐 Admin login attempt:", email);

  try {
    const admin = await Admin.findOne({ email });
    if (!admin) {
      console.log('❌ Admin not found:', email);
      return res.status(404).json({ 
        success: false,
        message: "Admin not found" 
      });
    }

    const isMatch = await bcrypt.compare(password, admin.password);
    if (!isMatch) {
      console.log('❌ Invalid password for admin:', email);
      return res.status(401).json({ 
        success: false,
        message: "Invalid email or password" 
      });
    }

    // Create token with admin role
    const token = jwt.sign(
      { 
        id: admin._id, 
        role: "admin",
        email: admin.email 
      }, 
      process.env.JWT_SECRET, 
      { expiresIn: "1d" }
    );

    console.log('✅ Admin login successful:', {
      id: admin._id,
      email: admin.email,
      name: admin.name
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
      },
    });
  } catch (err) {
    console.error('❌ Admin login error:', err);
    res.status(500).json({ 
      success: false,
      message: "Server error", 
      error: err.message 
    });
  }
};

// Admin verification endpoint
exports.verifyAdmin = async (req, res) => {
  try {
    console.log('✅ Admin verification controller called');
    
    // Admin is already verified by middleware and attached to req.admin
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

// Get admin data by ID
exports.getAdminData = async (req, res) => {
  try {
    const adminId = req.params.id;
    
    // Verify the requested admin matches the authenticated admin
    if (adminId !== req.admin._id.toString()) {
      console.log('❌ Admin ID mismatch:', {
        requested: adminId,
        authenticated: req.admin._id.toString()
      });
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