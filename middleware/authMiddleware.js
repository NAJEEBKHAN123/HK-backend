// middleware/authMiddleware.js - SIMPLIFIED VERSION
const jwt = require('jsonwebtoken');
const Partner = require('../model/Partner');

// Simple protect middleware for partners
exports.protect = async (req, res, next) => {
  try {
    console.log('🔐 Auth middleware called for:', req.originalUrl);
    
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

// Admin middleware
exports.verifyAdmin = async (req, res, next) => {
  try {
    let token;
    
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }
    
    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Admin access required - No token provided'
      });
    }
    
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    if (decoded.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Access denied. Admin account required'
      });
    }
    
    // Find admin (if you have Admin model)
    // const admin = await Admin.findById(decoded.id);
    // if (!admin) {
    //   return res.status(401).json({
    //     success: false,
    //     error: 'Admin not found'
    //   });
    // }
    
    req.admin = { id: decoded.id };
    req.user = { id: decoded.id, role: 'admin' };
    
    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      error: 'Admin authentication failed'
    });
  }
};