// controller/supeAdminController.js
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const Admin = require("../model/adminModel");

exports.loginAdmin = async (req, res) => {
  console.log('🔐 PRODUCTION - Admin login attempt:', {
    timestamp: new Date().toISOString(),
    nodeEnv: process.env.NODE_ENV,
    hasJwtSecret: !!process.env.JWT_SECRET,
    email: req.body.email,
    // Mask password in logs
    passwordProvided: req.body.password ? '***' : 'missing'
  });

  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ 
        success: false,
        message: "Email and password are required",
        debug: {
          emailProvided: !!email,
          passwordProvided: !!password
        }
      });
    }

    // Normalize email
    const normalizedEmail = email.toLowerCase().trim();
    console.log('📧 Normalized email:', normalizedEmail);

    const admin = await Admin.findOne({ email: normalizedEmail });
    
    console.log('🔍 Admin lookup result:', {
      found: !!admin,
      adminId: admin?._id,
      adminEmail: admin?.email,
      hasPassword: !!admin?.password,
      passwordLength: admin?.password?.length
    });

    if (!admin) {
      console.log('❌ Admin not found for email:', normalizedEmail);
      
      // List all admins for debugging
      const allAdmins = await Admin.find({}).select('email name');
      console.log('📋 All admins in DB:', allAdmins.map(a => ({ email: a.email, name: a.name })));
      
      return res.status(404).json({ 
        success: false,
        message: "Admin not found",
        debug: {
          searchedEmail: normalizedEmail,
          availableAdmins: process.env.NODE_ENV === 'development' ? allAdmins.map(a => a.email) : undefined
        }
      });
    }

    // DEBUG: Log the exact hash
    console.log('🔑 Password comparison:', {
      storedHash: admin.password,
      storedHashPrefix: admin.password.substring(0, 30) + '...',
      // Check hash algorithm
      isBcrypt: admin.password.startsWith('$2')
    });

    // Test with different bcrypt compare methods
    let isMatch;
    try {
      isMatch = await bcrypt.compare(password, admin.password);
      console.log('✅ Bcrypt compare result:', isMatch);
    } catch (bcryptError) {
      console.error('❌ Bcrypt compare error:', bcryptError.message);
      
      // Try manual comparison as fallback
      console.log('🔄 Trying manual hash comparison...');
      
      // Extract salt from stored hash
      const salt = admin.password.substring(0, 29);
      console.log('🧂 Extracted salt:', salt);
      
      try {
        const hashedPassword = await bcrypt.hash(password, salt);
        isMatch = hashedPassword === admin.password;
        console.log('🔑 Manual comparison result:', isMatch);
      } catch (hashError) {
        console.error('❌ Manual hash error:', hashError.message);
        isMatch = false;
      }
    }

    if (!isMatch) {
      console.log('❌ Password mismatch for admin:', admin.email);
      return res.status(401).json({ 
        success: false,
        message: "Invalid email or password",
        debug: process.env.NODE_ENV === 'development' ? {
          storedHashStart: admin.password.substring(0, 20),
          passwordLength: password.length
        } : undefined
      });
    }

    // Create token with environment check
    console.log('🎫 Creating JWT token...');
    console.log('JWT Secret exists:', !!process.env.JWT_SECRET);
    console.log('JWT Secret length:', process.env.JWT_SECRET?.length);
    
    const tokenPayload = {
      id: admin._id,
      role: "admin",
      email: admin.email,
      name: admin.name,
      env: process.env.NODE_ENV
    };
    
    console.log('📝 Token payload:', tokenPayload);

    const token = jwt.sign(
      tokenPayload,
      process.env.JWT_SECRET || 'fallback-secret-for-debugging',
      { expiresIn: "7d" }
    );

    console.log('✅ Admin login successful:', {
      id: admin._id,
      email: admin.email,
      tokenPreview: token.substring(0, 30) + '...',
      tokenLength: token.length
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
      debug: process.env.NODE_ENV === 'development' ? {
        tokenPreview: token.substring(0, 30) + '...'
      } : undefined
    });
  } catch (err) {
    console.error('❌ PRODUCTION - Full admin login error:', {
      message: err.message,
      stack: err.stack,
      body: req.body,
      env: process.env.NODE_ENV,
      nodeVersion: process.version
    });
    
    res.status(500).json({ 
      success: false,
      message: "Server error during admin login",
      error: process.env.NODE_ENV === 'development' ? err.message : undefined,
      timestamp: new Date().toISOString()
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