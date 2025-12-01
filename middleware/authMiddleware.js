// middleware/authMiddleware.js
const jwt = require('jsonwebtoken');
const Partner = require('../model/Partner');
const Admin = require('../model/adminModel');

// Simple protect middleware for partners
exports.protect = async (req, res, next) => {
  try {
    console.log('🔐 protect middleware called for:', req.originalUrl);
    
    let token;
    
    // Get token from header
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
      console.log('✅ Token found in Authorization header');
    } 
    // Get token from cookies
    else if (req.cookies?.token) {
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
    
    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    console.log('✅ Token decoded:', {
      id: decoded.id,
      role: decoded.role,
      email: decoded.email || 'No email'
    });
    
    // IMPORTANT: Check role first
    if (decoded.role !== 'partner') {
      console.log('❌ Not a partner token, role:', decoded.role);
      return res.status(403).json({
        success: false,
        error: 'Access denied. Partner account required'
      });
    }
    
    // Find the partner
    console.log('👤 Finding partner with ID:', decoded.id);
    const partner = await Partner.findById(decoded.id);
    
    if (!partner) {
      console.log('❌ Partner not found in database');
      return res.status(401).json({
        success: false,
        error: 'Partner not found'
      });
    }
    
    // Check if partner is active
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
    
    // Attach partner to request
    req.partner = partner;
    req.user = { id: partner._id, role: 'partner' };
    
    next();
    
  } catch (err) {
    console.error('❌ Auth middleware error:', {
      name: err.name,
      message: err.message,
      expiredAt: err.expiredAt
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
      ...(process.env.NODE_ENV === 'development' && { details: err.message })
    });
  }
};

// Simple verifyPartner middleware (just checks if partner exists)
exports.verifyPartner = (req, res, next) => {
  console.log('🔍 verifyPartner middleware: Checking partner access...');
  
  if (!req.partner) {
    console.log('❌ No partner in request');
    return res.status(401).json({
      success: false,
      error: 'Not authenticated as partner'
    });
  }
  
  console.log('✅ Partner access granted:', req.partner.email);
  next();
};

// Fixed Admin middleware
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
    
    // Check role - must be 'admin'
    if (decoded.role !== 'admin') {
      console.log('❌ Not an admin token, role:', decoded.role);
      return res.status(403).json({
        success: false,
        error: 'Access denied. Admin account required'
      });
    }
    
    // Find admin in database
    const admin = await Admin.findById(decoded.id);
    
    if (!admin) {
      console.log('❌ Admin not found in database');
      return res.status(401).json({
        success: false,
        error: 'Admin not found'
      });
    }
    
    console.log('✅ Admin authenticated:', {
      id: admin._id,
      name: admin.name,
      email: admin.email
    });
    
    // Set full admin object on request
    req.admin = admin;
    req.user = { id: admin._id, role: 'admin' };
    
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