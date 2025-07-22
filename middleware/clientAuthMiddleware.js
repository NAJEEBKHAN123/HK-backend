// const jwt = require('jsonwebtoken');
// const Client = require('../model/Client');
// const Partner = require('../model/Partner');

// // Error response helper
// const errorResponse = (res, statusCode, message) => {
//   return res.status(statusCode).json({
//     success: false,
//     error: message
//   });
// };

// // Main authentication middleware
// const protect = async (req, res, next) => {
//   let token;
  
//   // Get token from header
//   if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
//     token = req.headers.authorization.split(' ')[1];
//   }
//   // Get token from cookie (if using cookies)
//   else if (req.cookies?.token) {
//     token = req.cookies.token;
//   }

//   // If no token and route requires auth, return error
//   if (!token && req.authRequired) {
//     return errorResponse(res, 401, 'Not authorized, no token provided');
//   }

//   // If token exists, verify it
//   if (token) {
//     try {
//       const decoded = jwt.verify(token, process.env.JWT_SECRET);
      
//       // Find user based on role in token
//       let user;
//       if (decoded.role === 'client') {
//         user = await Client.findById(decoded.id).select('-password');
//       } else if (decoded.role === 'partner') {
//         user = await Partner.findById(decoded.id).select('-password');
//       }

//       if (!user) {
//         return errorResponse(res, 401, 'Not authorized, user not found');
//       }

//       // Attach user to request
//       req.user = user;
//       req.token = token;
//       next();
//     } catch (error) {
//       console.error('Token verification error:', error);
//       return errorResponse(res, 401, 'Not authorized, token failed');
//     }
//   } else {
//     // No token but route doesn't require auth
//     next();
//   }
// };

// // Role-based access control
// const role = (...roles) => {
//   return (req, res, next) => {
//     if (!roles.includes(req.user?.role)) {
//       return errorResponse(res, 403, `User role ${req.user?.role} is not authorized`);
//     }
//     next();
//   };
// };

// // Route-specific auth requirements
// const requireAuth = (req, res, next) => {
//   req.authRequired = true;
//   next();
// };

// const optionalAuth = (req, res, next) => {
//   req.authRequired = false;
//   next();
// };

// module.exports = {
//   protect,
//   role,
//   requireAuth,
//   optionalAuth
// };