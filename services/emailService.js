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

    this.emailLocks = new Map();
    this.verifyConnection().catch(err => {
      console.error('❌ SMTP verification failed:', err.message);
    });
  }

  async verifyConnection() {
    if (!this.transporter) throw new Error('Email transporter not configured');
    await this.transporter.verify();
    console.log('✅ SMTP connection verified');
  }

  async sendDualNotification(order) {
    const lockKey = `order-${order._id}`;
    
    // Prevent duplicate processing for 1 hour
    if (this.emailLocks.has(lockKey)) {
      return null;
    }

    this.emailLocks.set(lockKey, true);
    setTimeout(() => this.emailLocks.delete(lockKey), 3600000); // Clear after 1 hour

    try {
      // 1. Prepare client email
      const clientEmail = {
        from: `"${process.env.EMAIL_FROM_NAME}" <${process.env.EMAIL_FROM}>`,
        to: order.email,
        subject: `Payment Confirmation - Order #${order._id}`,
        html: this.getClientEmailHtml(order),
        text: this.getClientEmailText(order)
      };

      // 2. Prepare admin email (only if different from client)
      let adminEmail = null;
      if (process.env.ADMIN_EMAIL && 
          process.env.ADMIN_EMAIL !== order.email &&
          process.env.ADMIN_EMAIL !== process.env.EMAIL_FROM) {
        adminEmail = {
          from: `"${process.env.EMAIL_FROM_NAME}" <${process.env.EMAIL_FROM}>`,
          to: process.env.ADMIN_EMAIL,
          subject: `⚠ URGENT ‼ PAYMENT COMING - Order ID #${order._id}`,
          html: this.getAdminEmailHtml(order),
          text: this.getAdminEmailText(order)
        };
      }

      // 3. Send emails
      const results = await Promise.all([
        this.sendEmail(clientEmail),
        adminEmail ? this.sendEmail(adminEmail) : null
      ].filter(Boolean));

      return {
        client: results[0],
        admin: results[1] || null
      };
    } catch (error) {
      this.emailLocks.delete(lockKey);
      console.error('Email sending failed:', error);
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
      return info;
    } catch (error) {
      console.error('❌ Email failed to send:', {
        to: mailOptions.to,
        error: error.message
      });
      throw error;
    }
  }

  // Template methods
  getClientEmailHtml(order) {
    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #4CAF50;">Payment Successful!</h2>
        ${this.getOrderDetailsHtml(order)}
        ${this.getFooterHtml()}
      </div>
    `;
  }

  getAdminEmailHtml(order) {
    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #2196F3;">New Payment Received</h2>
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd; width: 30%;"><strong>Order Id #</strong></td>
            <td style="padding: 8px; border: 1px solid #ddd;">${order._id}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd;"><strong>Plan</strong></td>
            <td style="padding: 8px; border: 1px solid #ddd;">${order.plan}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd;"><strong>Amount</strong></td>
            <td style="padding: 8px; border: 1px solid #ddd;">${this.formatCurrency(order.price)}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd;"><strong>Client Name</strong></td>
            <td style="padding: 8px; border: 1px solid #ddd;">${order.fullName}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd;"><strong>Client Email</strong></td>
            <td style="padding: 8px; border: 1px solid #ddd;">(${order.email})</td>
          </tr>
        </table>
      </div>
    `;
  }

  getOrderDetailsHtml(order) {
    return `
      <table style="width: 100%; border-collapse: collapse;">
       <tr>
          <td style="padding: 8px; border: 1px solid #ddd; width: 30%;"><strong>Order Id #</strong></td>
          <td style="padding: 8px; border: 1px solid #ddd;">${order._id}</td>
        </tr>
        <tr>
          <td style="padding: 8px; border: 1px solid #ddd; width: 30%;"><strong>Plan</strong></td>
          <td style="padding: 8px; border: 1px solid #ddd;">${order.plan}</td>
        </tr>
        <tr>
          <td style="padding: 8px; border: 1px solid #ddd;"><strong>Amount</strong></td>
          <td style="padding: 8px; border: 1px solid #ddd;">${this.formatCurrency(order.price)}</td>
        </tr>
      </table>
    `;
  }

  getFooterHtml() {
    return `
      <div style="margin-top: 30px; font-size: 12px; color: #777;">
        <p>© ${new Date().getFullYear()} ${process.env.EMAIL_FROM_NAME}. All rights reserved.</p>
      </div>
    `;
  }

  getClientEmailText(order) {
    return `Payment Successful!\n\nOrder #${order._id}\nPlan: ${order.plan}\nAmount: ${this.formatCurrency(order.price)}\n\nView your order: ${this.getOrderUrl(order._id)}`;
  }

  getAdminEmailText(order) {
    return `New Payment Received\n\nOrder #${order._id}\nPlan: ${order.plan}\nAmount: ${this.formatCurrency(order.price)}\nClient: ${order.fullName || 'N/A'} (${order.email})\nPayment ID: ${order.stripePaymentIntentId || 'Processing...'}`;
  }

  getOrderUrl(orderId) {
    return `${process.env.FRONTEND_URL}/orders/${orderId}`;
  }

  formatCurrency(amount) {
    return new Intl.NumberFormat('en-US', { 
      style: 'currency', 
      currency: 'EUR' 
    }).format(amount);
  }
}

module.exports = new EmailService();