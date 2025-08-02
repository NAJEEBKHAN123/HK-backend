// services/emailService.js
const nodemailer = require('nodemailer');




class EmailService {
  constructor() {
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASSWORD) {
      console.warn('⚠️ Email service not configured - emails will be logged but not sent');
      this.transporter = null;
      return;
    }

    this.transporter = nodemailer.createTransport({
      host: process.env.EMAIL_HOST,
      port: parseInt(process.env.EMAIL_PORT),
      secure: process.env.EMAIL_SECURE === 'true',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD
      },
      tls: {
        rejectUnauthorized: false
      }
    });

    // console.log('Current SMTP config:', {
    //   host: process.env.EMAIL_HOST,
    //   port: process.env.EMAIL_PORT,
    //   user: process.env.EMAIL_USER,
    //   usingCustom: true
    // });

    this.verifyConnection().catch(err => {
      console.error('❌ SMTP verification failed:', err.message);
    });
  }

  async verifyConnection() {
    if (!this.transporter) throw new Error('Email transporter not configured');
    await this.transporter.verify();
    console.log('✅ SMTP connection verified');
  }

  async sendEmail(mailOptions) {
    if (!this.transporter) {
      console.log('[Email Mock]', {
        to: mailOptions.to,
        subject: mailOptions.subject,
        htmlPreview: mailOptions.html?.substring(0, 100) + '...'
      });
      return { accepted: [mailOptions.to], messageId: 'mocked' };
    }

    try {
      const info = await this.transporter.sendMail({
        ...mailOptions,
        from: mailOptions.from || `"${process.env.EMAIL_FROM_NAME}" <${process.env.EMAIL_FROM}>`
      });
      console.log('✅ Email sent:', info.messageId);
      return info;
    } catch (error) {
      console.error('❌ Email failed to send:', {
        to: mailOptions.to,
        error: error.message
      });
      throw error;
    }
  }

  // Add the contact email functions here
  async sendContactEmail({ name, email, phone, message }) {
    return this.sendEmail({
      to: process.env.CONTACT_RECIPIENT,
      subject: `New contact from ${name}`,
      html: `
        <h2>New Contact Message</h2>
        <p><strong>Name:</strong> ${name}</p>
        <p><strong>Email:</strong> ${email}</p>
        <p><strong>Phone:</strong> ${phone || 'N/A'}</p>
        <p><strong>Message:</strong> ${message}</p>
      `
    });
  }

  async sendConfirmationEmail({ name, email }) {
    return this.sendEmail({
      to: email,
      subject: 'We received your message',
      html: `
        <h3>Hi ${name},</h3>
        <p>Thanks for reaching out. We have received your message and will get back to you shortly.</p>
        <br/>
        <p>Regards,<br/>OuvrirSociete Team</p>
      `
    });
  }

  

  getOrderConfirmationHtml(order) {
    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #4CAF50;">Payment Successful!</h2>
        <p>Thank you for your order. Here are your order details:</p>
        
        <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd; width: 30%;"><strong>Order ID</strong></td>
            <td style="padding: 8px; border: 1px solid #ddd;">${order._id}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd;"><strong>Plan</strong></td>
            <td style="padding: 8px; border: 1px solid #ddd;">${order.plan}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd;"><strong>Amount</strong></td>
            <td style="padding: 8px; border: 1px solid #ddd;">${this.formatCurrency(order.originalPrice  || order.amount)}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd;"><strong>Date</strong></td>
            <td style="padding: 8px; border: 1px solid #ddd;">${new Date(order.createdAt).toLocaleString()}</td>
          </tr>
        </table>

        <p>If you have any questions, please contact our support team.</p>
        
        <div style="margin-top: 30px; font-size: 12px; color: #777;">
          <p>© ${new Date().getFullYear()} ${process.env.EMAIL_FROM_NAME || 'Your Company'}. All rights reserved.</p>
        </div>
      </div>
    `;
  }

  getOrderConfirmationText(order) {
    return `
      Payment Successful!
      
      Order ID: ${order._id}
      Plan: ${order.plan}
      Amount: ${this.formatCurrency(order.originalPrice || order.amount)}
      Date: ${new Date(order.createdAt).toLocaleString()}
      
      Thank you for your order!
    `;
  }
    formatCurrency = (amount) => {
    return `€${amount.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
  };
}

module.exports = new EmailService();