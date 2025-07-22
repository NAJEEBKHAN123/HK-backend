const express = require('express');
const router = express.Router();
const authController = require('../controller/clientAuthController');

router.post('/signup', authController.clientSignup);
router.post('/login',  authController.clientLogin);

module.exports = router;