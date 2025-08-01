const nodemailer = require('nodemailer');

// Use environment variables for ALL configuration
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST, // mail.ouvrir-societe-hong-kong.fr
  port: parseInt(process.env.EMAIL_PORT), // 587
  secure: process.env.EMAIL_SECURE === 'true', // false for 587
  auth: {
    user: process.env.EMAIL_USER, // bonjour@ouvrir-societe-hong-kong.fr
    pass: process.env.EMAIL_PASSWORD // Ludovic2609!
  },
  tls: {
    rejectUnauthorized: false // For development only
  }
});

exports.sendEmail = async ({ to, subject, html }) => {
  await transporter.sendMail({
    from: `"${process.env.EMAIL_FROM_NAME}" <${process.env.EMAIL_FROM}>`,
    to,
    subject,
    html
  });
};

exports.sendAdminNotification = async (type, data) => {
  let subject, html;
  
  if (type === 'NEW_PARTNER_REGISTRATION') {
    subject = 'New Partner Registration';
    html = `
      <h2>New Partner Request</h2>
      <p>Partner ID: ${data.partnerId}</p>
      <a href="${process.env.ADMIN_DASHBOARD_URL}/partners/${data.partnerId}">
        Review Partner Application
      </a>
    `;
  }

  await transporter.sendMail({
    from: `"${process.env.EMAIL_FROM_NAME}" <${process.env.EMAIL_FROM}>`,
    to: process.env.ADMIN_EMAIL,
    subject,
    html
  });
};