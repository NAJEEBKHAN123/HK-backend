const jwt = require('jsonwebtoken');
const Client = require('../model/Client');
const Partner = require('../model/Partner');
const Admin = require('../model/adminModel');
 

const verifyAdmin = (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1]; // Bearer <token>

  if (!token) {
    return res.status(401).json({ message: "Access denied. No token provided." });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.role !== "admin") {
      return res.status(403).json({ message: "Access denied. Not an admin." });
    }

    req.admin = decoded; // attach admin to request
    next();
  } catch (err) {
    res.status(400).json({ message: "Invalid token." });
  }
};

// authMiddleware.js
const protect = async (req, res, next) => {
  let token;
  
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  } else if (req.cookies.token) {
    token = req.cookies.token;
  }

  if (!token) {
    return res.status(401).json({
      success: false,
      error: 'Not authorized to access this route'
    });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Standardize user attachment
    req.user = {
      id: decoded.id || decoded._id, // Handle both id/_id
      role: decoded.role
    };
    
    // Still attach specific user types if needed
    if (decoded.role === 'client') {
      req.client = await Client.findById(decoded.id);
    } else if (decoded.role === 'partner') {
      req.partner = await Partner.findById(decoded.id);
    } else if (decoded.role === 'admin') {
      req.admin = await Admin.findById(decoded.id);
    }
    
    next();
  } catch (err) {
    return res.status(401).json({
      success: false,
      error: 'Not authorized to access this route'
    });
  }
};

const client = (req, res, next) => {
  if (!req.client) {
    return res.status(403).json({
      success: false,
      error: 'Not authorized as client'
    });
  }
  next();
};

// Export all middleware functions
module.exports = {
  verifyAdmin,
  protect,
  client
};