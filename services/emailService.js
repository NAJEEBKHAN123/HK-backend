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
      },
      logger: true,
      debug: true
    });

    this.verifyConnection().catch(err => {
      console.error('❌ SMTP verification failed:', err.message);
    });
  }

  async verifyConnection() {
    if (!this.transporter) throw new Error('Email transporter not configured');
    const success = await this.transporter.verify();
    console.log('✅ SMTP connection verified', success);
    return success;
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
      const fullOptions = {
        ...mailOptions,
        from: mailOptions.from || `"${process.env.EMAIL_FROM_NAME}" <${process.env.EMAIL_FROM}>`
      };
      
      console.log('Attempting to send email to:', fullOptions.to);
      const info = await this.transporter.sendMail(fullOptions);
      
      console.log('✅ Email successfully sent:', {
        messageId: info.messageId,
        to: info.accepted,
        subject: info.envelope.subject
      });
      return info;
    } catch (error) {
      console.error('❌ Email failed to send:', {
        to: mailOptions.to,
        error: error.message,
        stack: error.stack,
        response: error.response
      });
      throw error;
    }
  }

  async sendOrderConfirmation(order) {
    const customerEmail = order.customerDetails.email;
    const adminEmail = process.env.ADMIN_EMAIL || process.env.CONTACT_RECIPIENT;
    
    if (!adminEmail) {
      console.error('No admin email configured!');
      return;
    }

    // Send to customer
    try {
      console.log(`Sending confirmation to customer: ${customerEmail}`);
      await this.sendEmail({
        to: customerEmail,
        subject: `Your Order Confirmation - #${order._id}`,
        html: this.getOrderConfirmationHtml(order),
        text: this.getOrderConfirmationText(order)
      });
    } catch (customerError) {
      console.error('Failed to send customer confirmation:', customerError);
    }

    // Send to admin (with different from address to avoid blocking)
    try {
      console.log(`Sending notification to admin: ${adminEmail}`);
      await this.sendEmail({
        to: adminEmail,
        from: `"Order Notifications" <${process.env.EMAIL_FROM}>`,
        subject: `📦 New Order #${order._id}`,
        html: this.getAdminNotificationHtml(order),
        priority: 'high'
      });
    } catch (adminError) {
      console.error('Failed to send admin notification:', adminError);
    }
  }

  async sendPaymentSuccess(order) {
    try {
      await this.sendEmail({
        to: order.customerDetails.email,
        subject: `Payment Received - Order #${order._id}`,
        html: this.getPaymentSuccessHtml(order)
      });
    } catch (error) {
      console.error('Failed to send payment confirmation:', error);
    }
  }

  getAdminNotificationHtml(order) {
    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #d35400;">NEW ORDER RECEIVED</h2>
        <h3>Order #${order._id}</h3>
        
        <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd; width: 30%;"><strong>Plan</strong></td>
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
        </table>

        <h3 style="margin-top: 25px;">Customer Details</h3>
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd; width: 30%;"><strong>Name</strong></td>
            <td style="padding: 8px; border: 1px solid #ddd;">${order.customerDetails.fullName}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd;"><strong>Email</strong></td>
            <td style="padding: 8px; border: 1px solid #ddd;">${order.customerDetails.email}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd;"><strong>Phone</strong></td>
            <td style="padding: 8px; border: 1px solid #ddd;">${order.customerDetails.phone || 'N/A'}</td>
          </tr>
        </table>

        <div style="margin-top: 30px; padding: 15px; background-color: #f8f9fa; border-left: 4px solid #d35400;">
          <p><strong>Action Required:</strong> Process this order within 24 hours</p>
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

  getOrderDetailsTable(order) {
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

  formatCurrency(amount) {
    return `€${(amount / 100).toFixed(2).replace('.', ',')}`;
  }

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