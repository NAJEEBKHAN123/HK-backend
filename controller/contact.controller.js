// controllers/contact.js
const Contact = require('../model/contact.model'); // Fixed path (models instead of model)
const { sendContactEmail, sendConfirmationEmail } = require('../utils/mailer');


exports.submitContactForm = async (req, res) => {
  try {
    const { name, email, phone, message } = req.body;

    if (!name || !email || !message) {
      return res.status(400).json({ 
        success: false, 
        message: 'Name, email, and message are required' 
      });
    }

    const newContact = new Contact({ name, email, phone, message });
    await newContact.save();

    // Send admin notification
    sendContactEmail({ name, email, phone, message })
      .catch(err => console.error('Admin email failed:', err));

    // Send auto-confirmation to user
    sendConfirmationEmail({ name, email })
      .catch(err => console.error('User confirmation email failed:', err));

    return res.status(200).json({ 
      success: true, 
      message: "Message sent successfully and confirmation email sent!",
      data: {
        contactId: newContact._id,
        timestamp: new Date()
      }
    });

  } catch (error) {
    console.error("Contact submission error:", error);
    
    if (error.code === 11000 && error.keyPattern?.email) {
      return res.status(400).json({
        success: false,
        message: "This email has already submitted a message recently"
      });
    }

    return res.status(500).json({ 
      success: false, 
      message: "Failed to send message"
    });
  }
};
