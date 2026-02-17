// routes/adminDashboard.js
const express = require('express');
const router = express.Router();
const { verifyAdmin } = require('../middleware/authMiddleware');
const dashboardController = require('../controller/adminDashboardController');

// Dashboard statistics
router.get('/dashboard/stats', verifyAdmin, dashboardController.getDashboardStats);
router.get('/dashboard/quick-stats', verifyAdmin, dashboardController.getQuickStats);
router.get('/dashboard/reports', verifyAdmin, dashboardController.getReports);

module.exports = router;