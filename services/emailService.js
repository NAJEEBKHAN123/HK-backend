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

  // Order-related email methods
// services/emailService.js
   async sendOrderConfirmation(order) {
    const customerEmail = order.customerDetails.email;
    const adminEmail = process.env.ADMIN_EMAIL || process.env.CONTACT_RECIPIENT;

    console.log('[Email Service] Preparing to send order confirmation emails', {
      orderId: order._id,
      customerEmail,
      adminEmail
    });

    try {
      // Customer email - without referral info
      const customerResult = await this.sendEmail({
        to: customerEmail,
        subject: `Your Order Confirmation - #${order._id}`,
        html: this.getOrderConfirmationHtml(order),
        text: this.getOrderConfirmationText(order)
      });

      // Admin email - with full details including referral info
      const adminHtml = `
        <div style="font-family: Arial, sans-serif; max-width: 700px; margin: 0 auto;">
          <h2 style="color: #d32f2f; border-bottom: 1px solid #d32f2f; padding-bottom: 8px;">
            📦 New Order #${order._id}
          </h2>
        </div>
      `;

      const adminResult = await this.sendEmail({
        to: adminEmail,
        subject: `[ACTION REQUIRED] New Order #${order._id}`,
        html: adminHtml
      });

      return { customerResult, adminResult };
    } catch (error) {
      console.error('[Email Service] Failed to send order confirmation emails', {
        error: error.message,
        stack: error.stack,
        orderId: order._id
      });
      throw error;
    }
  }


  async sendPaymentSuccess(order) {
    return this.sendEmail({
      to: order.customerDetails.email,
      subject: `Payment Received - Order #${order._id}`,
      html: this.getPaymentSuccessHtml(order)
    });
  }

  // Template methods
 getOrderConfirmationHtml(order) {
    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #2c3e50;">Order Confirmation</h2>
        <p>Thank you for your order. Here are your order details:</p>
        
        ${this.getOrderDetailsTable(order, false)} <!-- false = not admin -->
        
        <p style="margin-top: 20px;">
          <strong>Next Steps:</strong> 
          ${order.status === 'completed' 
            ? 'Your payment has been received and we are processing your order.' 
            : 'Please complete your payment to proceed with your order.'}
        </p>
        
        <div style="margin-top: 30px; font-size: 12px; color: #777;">
          <p>© ${new Date().getFullYear()} ${process.env.EMAIL_FROM_NAME}. All rights reserved.</p>
        </div>
      </div>
    `;
}

  getPaymentSuccessHtml(order) {
    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #4CAF50;">Payment Confirmed!</h2>
        <p>We've successfully received your payment for order #${order._id}.</p>
        
        <h3 style="margin-top: 20px;">Next Steps:</h3>
        <ol>
          <li>Our team will review your order</li>
          <li>You'll receive a confirmation within 24-48 hours</li>
          <li>We'll contact you if we need additional information</li>
        </ol>
        
        ${this.getOrderDetailsTable(order)}
        
        <p style="margin-top: 20px;">
          <strong>Need help?</strong> Contact us at ${process.env.EMAIL_FROM}
        </p>
      </div>
    `;
  }

   getOrderDetailsTable(order, isAdmin = false) {
    return `
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
          <td style="padding: 8px; border: 1px solid #ddd;">${this.formatCurrency(order.originalPrice)}</td>
        </tr>
        <tr>
          <td style="padding: 8px; border: 1px solid #ddd;"><strong>Date</strong></td>
          <td style="padding: 8px; border: 1px solid #ddd;">${new Date(order.createdAt).toLocaleString()}</td>
        </tr>
        <tr>
          <td style="padding: 8px; border: 1px solid #ddd;"><strong>Customer Name</strong></td>
          <td style="padding: 8px; border: 1px solid #ddd;">${order.customerDetails.fullName}</td>
        </tr>
        <tr>
          <td style="padding: 8px; border: 1px solid #ddd;"><strong>Customer Email</strong></td>
          <td style="padding: 8px; border: 1px solid #ddd;">
            <a href="mailto:${order.customerDetails.email}">${order.customerDetails.email}</a>
          </td>
        </tr>
        <tr>
          <td style="padding: 8px; border: 1px solid #ddd;"><strong>Customer Phone</strong></td>
          <td style="padding: 8px; border: 1px solid #ddd;">
            ${order.customerDetails.phone || 'Not provided'}
          </td>
        </tr>
        ${isAdmin ? `
        <tr>
          <td style="padding: 8px; border: 1px solid #ddd;"><strong>Order Source</strong></td>
          <td style="padding: 8px; border: 1px solid #ddd;">${order.source || 'Direct'}</td>
        </tr>
        ${order.referralCode ? `
        <tr>
          <td style="padding: 8px; border: 1px solid #ddd;"><strong>Referral Code</strong></td>
          <td style="padding: 8px; border: 1px solid #ddd;">${order.referralCode}</td>
        </tr>
        ` : ''}
        ` : ''}
        ${order.paymentConfirmedAt ? `
        <tr>
          <td style="padding: 8px; border: 1px solid #ddd;"><strong>Payment Date</strong></td>
          <td style="padding: 8px; border: 1px solid #ddd;">${new Date(order.paymentConfirmedAt).toLocaleString()}</td>
        </tr>
        ` : ''}
      </table>
    `;
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

   formatCurrency = (amount) => {
    return `€${amount.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
  };

  // Contact form methods
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
        <p>Regards,<br/>${process.env.EMAIL_FROM_NAME}</p>
      `
    });
  }
}

module.exports = new EmailService();