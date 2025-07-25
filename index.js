require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const DBConnection = require('./db');
const bookingRouter = require('./routes/booking');
const contactRouter = require('./routes/contact.route');
const orderRouter = require('./routes/orderRoutes');
const adminRoutes = require('./routes/superAdminRoute')
const paymentRoutes = require('./routes/paymentRoutes');
const partnerAuthRoutes = require('./routes/partnerAuth');
const partnerAdminRoutes = require('./routes/admin');
const clientRoutes = require('./routes/clientRoute')



const app = express();

// Enhanced CORS configuration
const allowedOrigins = [
  "http://localhost:5173",
  "https://hk-frontend-rust.vercel.app"
];

app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
  origin: function (origin, callback) {
    // Allow requests with no origin (e.g., Postman) or matching origins
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("CORS not allowed from this origin: " + origin));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  
}));

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Database Connection
DBConnection();

// Routes
app.use('/api/bookings', bookingRouter);
app.use('/api/contact', contactRouter);
app.use('/api/orders', orderRouter);
app.use("/api/admin", adminRoutes);
app.use("/api/payments", paymentRoutes);
app.use('/api/partner-auth', partnerAuthRoutes);
app.use('/api/partner-admin', partnerAdminRoutes);
app.use('/api/auth/client', clientRoutes);


// Health Check
app.get('/api/health', (req, res) => {
  res.status(200).json({ 
    status: 'healthy',
    timestamp: new Date().toISOString()
  });
});

// Error Handling Middleware
app.use((err, req, res, next) => {
  console.error(`[${new Date().toISOString()}] Error:`, err.stack);
  
  res.status(500).json({
    success: false,
    message: process.env.NODE_ENV === 'development' 
      ? err.message 
      : 'Internal Server Error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running in ${process.env.NODE_ENV || 'development'} mode on port ${PORT}`);
});