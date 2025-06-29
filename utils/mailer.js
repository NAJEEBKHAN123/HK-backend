// utils/mailer.js
require('dotenv').config();
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,   // your Gmail address
    pass: process.env.EMAIL_PASS    // app password
  }
});

transporter.verify((error) => {
  if (error) {
    console.error('❌ SMTP Connection Failed:', error);
  } else {
    console.log('✅ SMTP Connection Ready');
  }
});

// Sends email to you (admin)
const sendContactEmail = async ({ name, email, phone, message }) => {
  const mailOptions = {
    from: `"Website Contact" <${process.env.EMAIL_USER}>`,
    to: process.env.CONTACT_RECIPIENT,
    subject: `New contact from ${name}`,
    html: `
      <h2>New Contact Message</h2>
      <p><strong>Name:</strong> ${name}</p>
      <p><strong>Email:</strong> ${email}</p>
      <p><strong>Phone:</strong> ${phone || 'N/A'}</p>
      <p><strong>Message:</strong> ${message}</p>
    `
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log('📧 Admin email sent');
    return true;
  } catch (error) {
    console.error('❌ Admin email failed:', error);
    return false;
  }
};

// Sends confirmation to the user
const sendConfirmationEmail = async ({ name, email }) => {
  const mailOptions = {
    from: `"CareerSociete Team" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: 'We received your message',
    html: `
      <h3>Hi ${name},</h3>
      <p>Thanks for reaching out. We have received your message and will get back to you shortly.</p>
      <br/>
      <p>Regards,<br/>CareerSociete Team</p>
    `
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log('📨 Confirmation email sent to user');
    return true;
  } catch (error) {
    console.error('❌ Confirmation email failed:', error);
    return false;
  }
};

module.exports = { sendContactEmail, sendConfirmationEmail };
