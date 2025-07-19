const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: 'gmail', // Changed from SendGrid
  auth: {
    user: process.env.EMAIL_USER, // Use Gmail email
    pass: process.env.EMAIL_PASSWORD // Use Gmail app password
  }
});

exports.sendEmail = async ({ to, subject, html }) => {
  await transporter.sendMail({
    from: '"Partner Program" <partners@yourdomain.com>',
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
    to: process.env.ADMIN_EMAIL,
    subject,
    html
  });
};