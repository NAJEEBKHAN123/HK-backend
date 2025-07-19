// routes/admin.js
const express = require('express');
const router = express.Router();
const {
  generatePartnerCredential,
  approvePartner
} = require('../controller/adminController');
const { verifyAdmin } = require('../middleware/authMiddleware');

// Apply admin auth middleware to all routes
router.use(verifyAdmin); // Directly use the middleware function

// Routes
router.post('/credentials', async (req, res, next) => {
  try {
    await generatePartnerCredential(req, res);
  } catch (err) {
    next(err);
  }
});

router.patch('/:id/approve', async (req, res, next) => {
  try {
    await approvePartner(req, res);
  } catch (err) {
    next(err);
  }
});

module.exports = router;