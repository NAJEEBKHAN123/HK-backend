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
      service: process.env.EMAIL_SERVICE || 'gmail',
      host: process.env.EMAIL_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.EMAIL_PORT) || 587,
      secure: process.env.EMAIL_SECURE === 'true',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD
      },
      pool: true,
      tls: {
        rejectUnauthorized: process.env.NODE_ENV !== 'production'
      }
    });

    this.verifyConnection().catch(err => {
      console.error('❌ SMTP verification failed:', err.message);
    });
  }

  async verifyConnection() {
    if (!this.transporter) throw new Error('Email transporter not configured');
    await this.transporter.verify();
    console.log('✅ SMTP connection verified');
  }

  async sendPaymentConfirmation(order) {
    try {
      if (!order.customerDetails?.email) {
        throw new Error('No recipient email provided');
      }

      const mailOptions = {
        from: `"${process.env.EMAIL_FROM_NAME || 'Your Company'}" <${process.env.EMAIL_FROM || process.env.EMAIL_USER}>`,
        to: order.customerDetails.email,
        subject: 'Order Confirmation',
        html: this.getOrderConfirmationHtml(order),
        text: this.getOrderConfirmationText(order)
      };

      return await this.sendEmail(mailOptions);
    } catch (error) {
      console.error('Payment confirmation email failed:', error);
      throw error;
    }
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
      const info = await this.transporter.sendMail(mailOptions);
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
            <td style="padding: 8px; border: 1px solid #ddd;">${this.formatCurrency(order.finalPrice || order.amount)}</td>
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
      Amount: ${this.formatCurrency(order.finalPrice || order.amount)}
      Date: ${new Date(order.createdAt).toLocaleString()}
      
      Thank you for your order!
    `;
  }

  formatCurrency(amount) {
    return new Intl.NumberFormat('en-US', { 
      style: 'currency', 
      currency: 'EUR' 
    }).format(amount / 100);
  }
}

module.exports = new EmailService();