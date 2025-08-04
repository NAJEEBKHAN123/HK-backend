const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');

class EmailService {
  constructor() {
    this.initializeTransporter();
    this.setupTemplates();
  }

  initializeTransporter() {
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASSWORD) {
      console.warn('⚠️ Email service not configured - emails will be logged but not sent');
      this.transporter = null;
      return;
    }

    this.transporter = nodemailer.createTransport({
      host: process.env.EMAIL_HOST,
      port: parseInt(process.env.EMAIL_PORT),
      secure: false, // false for port 587
      requireTLS: true, // requires TLS for port 587
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD
      },
      tls: {
        ciphers: 'SSLv3',
        rejectUnauthorized: false
      },
      logger: true,
      debug: true,
      connectionTimeout: 30000, // 30 seconds
      greetingTimeout: 30000,
      socketTimeout: 30000
    });

    this.verifyConnection().catch(err => {
      console.error('❌ Initial SMTP connection failed:', err);
      this.scheduleReconnect();
    });
  }

  setupTemplates() {
    this.templates = {
      orderConfirmation: {
        subject: (order) => `Your Order Confirmation - #${order._id}`,
        html: (order) => this.renderTemplate('order-confirmation', order)
      },
      adminNotification: {
        subject: (order) => `📦 New Order #${order._id}`,
        html: (order) => this.renderTemplate('admin-notification', order)
      },
      paymentSuccess: {
        subject: (order) => `Payment Received - Order #${order._id}`,
        html: (order) => this.renderTemplate('payment-success', order)
      }
    };
  }

  renderTemplate(templateName, data) {
    try {
      const templatePath = path.join(__dirname, `../templates/emails/${templateName}.html`);
      let template = fs.readFileSync(templatePath, 'utf8');
      
      // Simple template variable replacement
      template = template.replace(/{{\s*(\w+)\s*}}/g, (match, p1) => {
        return data[p1] || match;
      });
      
      return template;
    } catch (err) {
      console.error(`Failed to load template ${templateName}:`, err);
      return this.getFallbackTemplate(templateName, data);
    }
  }

  getFallbackTemplate(templateName, order) {
    // Simple fallback templates if file loading fails
    switch(templateName) {
      case 'order-confirmation':
        return `<h1>Order Confirmation</h1><p>Thank you for your order #${order._id}</p>`;
      case 'admin-notification':
        return `<h1>New Order</h1><p>Order #${order._id} received from ${order.customerDetails.email}</p>`;
      case 'payment-success':
        return `<h1>Payment Received</h1><p>Payment confirmed for order #${order._id}</p>`;
      default:
        return '<p>Email content</p>';
    }
  }

  scheduleReconnect() {
    if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
    this.reconnectTimeout = setTimeout(() => {
      console.log('Attempting to reconnect to SMTP server...');
      this.initializeTransporter();
    }, 5000); // Try again after 5 seconds
  }

  async verifyConnection() {
    if (!this.transporter) {
      throw new Error('SMTP transporter not initialized');
    }

    try {
      const success = await this.transporter.verify();
      console.log('✅ SMTP connection verified');
      return true;
    } catch (err) {
      console.error('❌ SMTP connection verification failed:', err);
      this.scheduleReconnect();
      throw err;
    }
  }

  async sendEmail(mailOptions) {
    if (!this.transporter) {
      console.log('[Email Mock]', mailOptions);
      return { accepted: [], messageId: 'mocked' };
    }

    // Verify connection first
    try {
      await this.verifyConnection();
    } catch (err) {
      console.error('Cannot send email - no valid SMTP connection');
      throw err;
    }

    const fullOptions = {
      ...mailOptions,
      from: mailOptions.from || `"${process.env.EMAIL_FROM_NAME}" <${process.env.EMAIL_FROM}>`,
      headers: {
        'X-Priority': '1',
        'X-Mailer': 'OuvrirSocieteMailer',
        'X-Accept-Language': 'fr-fr'
      }
    };

    try {
      console.log('Sending email to:', fullOptions.to);
      const info = await this.transporter.sendMail(fullOptions);
      console.log('✅ Email sent successfully:', info.messageId);
      return info;
    } catch (error) {
      console.error('❌ Email failed to send:', {
        to: fullOptions.to,
        error: error.message,
        response: error.response
      });

      if (error.code === 'ECONNECTION' || error.code === 'ETIMEDOUT') {
        this.scheduleReconnect();
      }

      throw error;
    }
  }

  async sendOrderConfirmation(order) {
    const customerEmail = order.customerDetails.email;
    const adminEmail = process.env.ADMIN_EMAIL;

    if (!adminEmail) {
      console.error('No admin email configured!');
      return;
    }

    // Prepare common data for templates
    const templateData = {
      ...order.toObject(),
      formattedAmount: this.formatCurrency(order.originalPrice),
      orderDate: new Date(order.createdAt).toLocaleString(),
      paymentDate: order.paymentConfirmedAt ? new Date(order.paymentConfirmedAt).toLocaleString() : 'Pending'
    };

    // Send to customer
    try {
      await this.sendEmail({
        to: customerEmail,
        subject: this.templates.orderConfirmation.subject(order),
        html: this.templates.orderConfirmation.html(templateData),
        text: this.getOrderConfirmationText(order)
      });
    } catch (error) {
      console.error('Failed to send customer confirmation:', error);
    }

    // Send to admin with different from address
    try {
      await this.sendEmail({
        to: adminEmail,
        from: `"Order System" <${process.env.EMAIL_FROM}>`,
        subject: this.templates.adminNotification.subject(order),
        html: this.templates.adminNotification.html(templateData),
        priority: 'high'
      });
    } catch (error) {
      console.error('Failed to send admin notification:', error);
    }
  }

  async sendPaymentSuccess(order) {
    try {
      const templateData = {
        ...order.toObject(),
        formattedAmount: this.formatCurrency(order.originalPrice),
        paymentDate: new Date(order.paymentConfirmedAt).toLocaleString()
      };

      await this.sendEmail({
        to: order.customerDetails.email,
        subject: this.templates.paymentSuccess.subject(order),
        html: this.templates.paymentSuccess.html(templateData)
      });
    } catch (error) {
      console.error('Failed to send payment confirmation:', error);
    }
  }

  getOrderConfirmationText(order) {
    return `
Order Confirmation

Order ID: ${order._id}
Plan: ${order.plan}
Amount: ${this.formatCurrency(order.originalPrice)}
Date: ${new Date(order.createdAt).toLocaleString()}

Thank you for your order!
${order.status === 'completed' 
  ? 'Your payment has been received and we are processing your order.' 
  : 'Please complete your payment to proceed with your order.'}

© ${new Date().getFullYear()} ${process.env.EMAIL_FROM_NAME}
    `;
  }

  formatCurrency(amount) {
    return `€${(amount / 100).toFixed(2).replace('.', ',')}`;
  }
}

module.exports = new EmailService();