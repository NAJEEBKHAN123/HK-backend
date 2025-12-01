// routes/admin.js - FOR ADMIN OPERATIONS (/api/admin/...)
const express = require('express');
const router = express.Router();
const {
  generatePartnerCredential,
  approvePartner
} = require('../controller/adminController');
const { verifyAdmin } = require('../middleware/authMiddleware');

console.log("🔄 Loading admin operations routes...");

// Apply admin auth middleware to all routes in this file
router.use(verifyAdmin);

console.log("✅ verifyAdmin middleware applied to all routes in this file");

// Routes
router.post('/credentials', async (req, res, next) => {
  try {
    console.log('📝 Generating partner credentials - Admin:', req.admin.email);
    await generatePartnerCredential(req, res);
  } catch (err) {
    console.error('❌ Error generating credentials:', err);
    next(err);
  }
});

router.patch('/:id/approve', async (req, res, next) => {
  try {
    console.log('✅ Approving partner - Admin:', req.admin.email);
    await approvePartner(req, res);
  } catch (err) {
    console.error('❌ Error approving partner:', err);
    next(err);
  }
});

// Add test endpoint to verify middleware
router.get('/test', (req, res) => {
  res.json({
    success: true,
    message: 'Admin operations route is working',
    admin: req.admin,
    timestamp: new Date().toISOString()
  });
});

console.log("✅ Admin operations routes loaded");

module.exports = router;