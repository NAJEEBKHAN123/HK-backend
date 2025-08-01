require('dotenv').config();
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: parseInt(process.env.EMAIL_PORT),
  secure: process.env.EMAIL_SECURE === 'true',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD
  },
  tls: { 
    rejectUnauthorized: false 
  },
  logger: true,
  debug: true
});

// Verify connection on startup
transporter.verify((error) => {
  if (error) {
    console.error('❌ SMTP Connection Failed:', error);
  } else {
    console.log('✅ SMTP Connection Ready');
  }
});

const sendEmail = async (mailOptions) => {
  try {
    const info = await transporter.sendMail({
      ...mailOptions,
      from: mailOptions.from || `"${process.env.EMAIL_FROM_NAME}" <${process.env.EMAIL_FROM}>`
    });
    console.log('📧 Email sent:', info.messageId);
    return info;
  } catch (error) {
    console.error('❌ Email failed:', error);
    throw error;
  }
};

module.exports = {
  transporter,  // Explicitly export transporter
  sendEmail,
  sendContactEmail: async ({ name, email, phone, message }) => {
    return sendEmail({
      to: process.env.CONTACT_RECIPIENT,
      subject: `New contact from ${name}`,
      html: `<h2>New Contact</h2><p>From: ${name} (${email})</p><p>${message}</p>`
    });
  },
  sendConfirmationEmail: async ({ name, email }) => {
    return sendEmail({
      to: email,
      subject: 'Confirmation',
      html: `<p>Hello ${name}, your request was received.</p>`
    });
  }
};