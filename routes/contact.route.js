// routes/contact.js
const express = require('express');
const router = express.Router();
const { submitContactForm } = require('../controller/contact.controller');

router.post('/', submitContactForm);

module.exports = router;