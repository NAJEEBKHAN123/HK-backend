const Contact = require('../model/contact.model');
const { sendContactEmail, sendConfirmationEmail } = require('../utils/mailer');
const rateLimit = require('express-rate-limit');
const validator = require('validator');

// Rate limiting (5 requests per 15 minutes)
exports.contactLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  handler: (req, res) => {
    return res.status(429).json({
      success: false,
      message: 'Too many submission attempts. Please try again later.'
    });
  }
});

exports.submitContactForm = async (req, res) => {
  try {
    const { name, email, phone, message } = req.body;

    // Enhanced validation
    const errors = {};
    if (!name?.trim()) errors.name = 'Name is required';
    if (!email?.trim()) errors.email = 'Email is required';
    else if (!validator.isEmail(email)) errors.email = 'Invalid email format';
    if (!message?.trim()) errors.message = 'Message is required';
    if (phone && !validator.isMobilePhone(phone)) errors.phone = 'Invalid phone number';

    if (Object.keys(errors).length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors
      });
    }

    // Create and save contact
    const newContact = new Contact({
      name: validator.escape(name.trim()),
      email: validator.normalizeEmail(email.trim()),
      phone: phone ? validator.escape(phone.trim()) : undefined,
      message: validator.escape(message.trim()),
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    });

    await newContact.save(); 
    console.log(newContact)

    // Send emails (fire-and-forget)
    Promise.all([
      sendContactEmail({
        name: newContact.name,
        email: newContact.email,
        phone: newContact.phone,
        message: newContact.message
      }),
      sendConfirmationEmail({
        name: newContact.name,
        email: newContact.email
      })
    ]).catch(err => console.error('Email delivery error:', err));

    return res.status(200).json({
      success: true,
      message: 'Thank you! Your message has been sent.',
      contactId: newContact._id
    });

  } catch (error) {
    console.error('Contact submission error:', error);

    // Handle duplicate submissions
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'You have already submitted a message recently.'
      });
    }

    // Handle validation errors
    if (error.name === 'ValidationError') {
      const errors = {};
      Object.keys(error.errors).forEach(key => {
        errors[key] = error.errors[key].message;
      });
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors
      });
    }

    return res.status(500).json({
      success: false,
      message: 'An unexpected error occurred. Please try again later.'
    });
  }
};