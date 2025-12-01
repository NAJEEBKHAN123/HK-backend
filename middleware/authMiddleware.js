const jwt = require('jsonwebtoken');
const Client = require('../model/Client');
const Partner = require('../model/Partner');
const Admin = require('../model/adminModel');

// Unified token extraction function
const extractToken = (req) => {
  // Check Authorization header first
  if (req.headers.authorization?.startsWith('Bearer')) {
    return req.headers.authorization.split(' ')[1];
  }
  
  // Then check cookies
  if (req.cookies?.token) {
    return req.cookies.token;
  }
  
  // Finally check query parameters (for special cases)
  if (req.query?.token) {
    return req.query.token;
  }
  
  return null;
};

// Base protection middleware
const protect = async (req, res, next) => {
  try {
    const token = extractToken(req);
    
    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required - No token provided'
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    console.log('🔐 Token decoded:', {
      id: decoded.id,
      role: decoded.role,
      email: decoded.email || 'No email in token'
    });
    
    // Standardize user attachment
    req.user = {
      id: decoded.id,
      role: decoded.role
    };
    
    // Attach specific user document based on role
    let userModel;
    switch(decoded.role) {
      case 'client':
        userModel = await Client.findById(decoded.id);
        req.client = userModel;
        break;
      case 'partner':
        userModel = await Partner.findById(decoded.id);
        req.partner = userModel;
        break;
      case 'admin':
        userModel = await Admin.findById(decoded.id);
        req.admin = userModel;
        break;
      default:
        throw new Error('Unknown user role: ' + decoded.role);
    }

    if (!userModel) {
      return res.status(404).json({
        success: false,
        error: 'User account not found'
      });
    }
    
    console.log('✅ User authenticated:', {
      role: decoded.role,
      name: userModel.name,
      email: userModel.email
    });
    
    next();
  } catch (err) {
    console.error('❌ Authentication error:', err.message);
    
    let errorMessage = 'Authentication failed';
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

// Role verification middlewares
const verifyAdmin = (req, res, next) => {
  console.log('🔍 Checking admin access:', {
    hasAdmin: !!req.admin,
    userRole: req.user?.role
  });
  
  if (!req.admin || req.user?.role !== 'admin') {
    return res.status(403).json({
      success: false,
      error: 'Access denied. Admin account required'
    });
  }
  next();
};

// FIXED: verifyPartner function
const verifyPartner = (req, res, next) => {
  console.log('🔍 Checking partner access:', {
    hasPartner: !!req.partner,
    userRole: req.user?.role,
    partnerId: req.partner?._id,
    partnerEmail: req.partner?.email
  });
  
  if (!req.partner || req.user?.role !== 'partner') {
    console.log('❌ Partner access denied:', {
      reason: !req.partner ? 'No partner object' : 'Wrong role: ' + req.user?.role
    });
    return res.status(403).json({
      success: false,
      error: 'Access denied. Partner account required'
    });
  }
  
  console.log('✅ Partner access granted:', req.partner.email);
  next();
};

const requireClient = (req, res, next) => {
  if (!req.client) {
    return res.status(403).json({
      success: false,
      error: 'Access denied. Client account required'
    });
  }
  next();
};

module.exports = {
  protect,        // General authentication check
  verifyAdmin,    // Requires admin role
  verifyPartner,  // Requires partner role
  requireClient,  // Requires client role
};