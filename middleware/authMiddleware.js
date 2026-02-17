// middleware/authMiddleware.js
const jwt = require('jsonwebtoken');
const Partner = require('../model/Partner');
const Admin = require('../model/adminModel');

// Simple protect middleware for partners
exports.protect = async (req, res, next) => {
  try {
    console.log('🔐 protect middleware called for:', req.originalUrl);
    
    let token;
    
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
      console.log('✅ Token found in Authorization header');
    } else if (req.cookies?.token) {
      token = req.cookies.token;
      console.log('✅ Token found in cookies');
    }
    
    if (!token) {
      console.log('❌ No token provided');
      return res.status(401).json({
        success: false,
        error: 'Not authorized to access this route'
      });
    }
    
    console.log('🔍 Verifying token...');
    
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    console.log('✅ Token decoded:', {
      id: decoded.id,
      role: decoded.role,
      email: decoded.email || 'No email'
    });
    
    if (decoded.role !== 'partner') {
      console.log('❌ Not a partner token, role:', decoded.role);
      return res.status(403).json({
        success: false,
        error: 'Access denied. Partner account required'
      });
    }
    
    console.log('👤 Finding partner with ID:', decoded.id);
    const partner = await Partner.findById(decoded.id);
    
    if (!partner) {
      console.log('❌ Partner not found in database');
      return res.status(401).json({
        success: false,
        error: 'Partner not found'
      });
    }
    
    if (partner.status !== 'active') {
      console.log('❌ Partner account is not active:', partner.status);
      return res.status(401).json({
        success: false,
        error: 'Account is not active'
      });
    }
    
    console.log('✅ Partner authenticated:', {
      id: partner._id,
      name: partner.name,
      email: partner.email
    });
    
    req.partner = partner;
    req.user = { id: partner._id, role: 'partner' };
    
    next();
    
  } catch (err) {
    console.error('❌ Auth middleware error:', {
      name: err.name,
      message: err.message
    });
    
    let errorMessage = 'Not authorized to access this route';
    if (err.name === 'JsonWebTokenError') {
      errorMessage = 'Invalid token';
    } else if (err.name === 'TokenExpiredError') {
      errorMessage = 'Token expired';
    }
    
    return res.status(401).json({
      success: false,
      error: errorMessage,
      details: err.message
    });
  }
};

// middleware/authMiddleware.js - Updated verifyPartner
exports.verifyPartner = async (req, res, next) => {
  try {
    console.log('🔍 verifyPartner middleware: Checking partner access...');
    
    let token;
    
    // Get token from header
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }
    
    if (!token) {
      console.log('❌ No token provided');
      return res.status(401).json({
        success: false,
        error: 'Not authorized to access this route'
      });
    }
    
    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    if (decoded.role !== 'partner') {
      console.log('❌ Not a partner token, role:', decoded.role);
      return res.status(403).json({
        success: false,
        error: 'Access denied. Partner account required'
      });
    }
    
    // Find partner
    const partner = await Partner.findById(decoded.id);
    
    if (!partner) {
      console.log('❌ Partner not found in database');
      return res.status(401).json({
        success: false,
        error: 'Partner not found'
      });
    }
    
    if (partner.status !== 'active') {
      console.log('❌ Partner account is not active:', partner.status);
      return res.status(401).json({
        success: false,
        error: 'Account is not active'
      });
    }
    
    console.log('✅ Partner authenticated:', {
      id: partner._id,
      name: partner.name,
      email: partner.email
    });
    
    req.partner = partner;
    req.user = { id: partner._id, role: 'partner' };
    
    next();
    
  } catch (err) {
    console.error('❌ verifyPartner error:', {
      name: err.name,
      message: err.message
    });
    
    let errorMessage = 'Not authorized to access this route';
    if (err.name === 'JsonWebTokenError') {
      errorMessage = 'Invalid token';
    } else if (err.name === 'TokenExpiredError') {
      errorMessage = 'Token expired';
    }
    
    return res.status(401).json({
      success: false,
      error: errorMessage,
      details: err.message
    });
  }
};

// FIXED: verifyAdmin middleware
exports.verifyAdmin = async (req, res, next) => {
  try {
    console.log('🔐 verifyAdmin middleware called for:', req.originalUrl);
    
    let token;
    
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
      console.log('✅ Admin token from header');
    }
    
    if (!token) {
      console.log('❌ No admin token provided');
      return res.status(401).json({
        success: false,
        error: 'Admin access required - No token provided'
      });
    }
    
    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    console.log('✅ Admin token decoded:', {
      id: decoded.id,
      role: decoded.role,
      email: decoded.email || 'No email'
    });
    
    // CRITICAL FIX: Check if role is 'admin'
    if (decoded.role !== 'admin') {
      console.log('❌ Not an admin token, role:', decoded.role);
      return res.status(403).json({
        success: false,
        error: 'Access denied. Admin account required'
      });
    }
    
    // Try to find admin in database
    const admin = await Admin.findById(decoded.id);
    
    if (!admin) {
      console.log('⚠️ Admin ID not found in database:', decoded.id);
      console.log('📋 Checking all admins...');
      
      // List all admins for debugging
      const allAdmins = await Admin.find({});
      console.log('All admins in DB:', allAdmins.map(a => ({ id: a._id, email: a.email })));
      
      // If admin not found but token has admin role, still proceed
      console.log('🔄 Creating virtual admin from token...');
      req.admin = {
        _id: decoded.id,
        email: decoded.email,
        name: decoded.name || 'Admin',
        role: 'admin'
      };
    } else {
      console.log('✅ Admin found in database:', admin.email);
      req.admin = admin;
    }
    
    req.user = { id: req.admin._id, role: 'admin' };
    
    console.log('✅ Admin authentication successful:', {
      id: req.admin._id,
      email: req.admin.email
    });
    
    next();
    
  } catch (error) {
    console.error('❌ verifyAdmin error:', {
      name: error.name,
      message: error.message
    });
    
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        error: 'Invalid token'
      });
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        error: 'Token expired'
      });
    }
    
    return res.status(500).json({
      success: false,
      error: 'Admin authentication failed'
    });
  }
};