const express = require('express');
const router = express.Router();
const {
  verifyInvite,
  registerPartner
} = require('../controller/partnerController');

// Add this new route for invite verification
router.post('/verify-invite', verifyInvite);
router.post('/register', registerPartner);

module.exports = router;