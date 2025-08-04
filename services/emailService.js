const nodemailer = require('nodemailer');

class EmailService {
 constructor() {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASSWORD) {
    console.warn('⚠️ Email service not configured');
    this.transporter = null;
    return;
  }

  // Use these specific options for your Hosterion mail server
  this.transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: parseInt(process.env.EMAIL_PORT),
    secure: false, // Explicitly set to false
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASSWORD
    },
    tls: {
      rejectUnauthorized: false // Needed for some servers
    },
    logger: true,
    debug: true,
    connectionTimeout: 10000, // 10 seconds
    greetingTimeout: 10000,   // 10 seconds
    socketTimeout: 10000      // 10 seconds
  });

  // Test connection immediately
  this.verifyConnection().catch(err => {
    console.error('SMTP Connection Error:', {
      message: err.message,
      code: err.code,
      response: err.response
    });
  });
}

  async verifyConnection() {
    if (!this.transporter) throw new Error('Email transporter not configured');
    const result = await this.transporter.verify();
    console.log('✅ SMTP connection verified', result);
    return result;
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
      console.log('Attempting to send email:', {
        from: mailOptions.from || `"${process.env.EMAIL_FROM_NAME}" <${process.env.EMAIL_FROM}>`,
        to: mailOptions.to,
        subject: mailOptions.subject
      });

      const info = await this.transporter.sendMail({
        ...mailOptions,
        from: mailOptions.from || `"${process.env.EMAIL_FROM_NAME}" <${process.env.EMAIL_FROM}>`
      });

      console.log('✅ Email sent successfully:', {
        messageId: info.messageId,
        response: info.response,
        accepted: info.accepted,
        rejected: info.rejected
      });
      return info;
    } catch (error) {
      console.error('❌ Email sending failed:', {
        error: error.message,
        stack: error.stack,
        response: error.response,
        responseCode: error.responseCode,
        command: error.command,
        mailOptions: {
          to: mailOptions.to,
          subject: mailOptions.subject
        }
      });
      throw error;
    }
  }

  async sendOrderConfirmation(order) {
    const customerEmail = order.customerDetails.email;
    const adminEmail = process.env.ADMIN_EMAIL || process.env.CONTACT_RECIPIENT;

    if (!customerEmail) {
      throw new Error('Customer email is required for order confirmation');
    }

    console.log('Preparing order confirmation emails:', {
      orderId: order._id,
      customerEmail,
      adminEmail,
      customerEmailValid: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail),
      adminEmailValid: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)
    });

    try {
      // Customer email
      const customerMail = {
        to: customerEmail,
        subject: `Your Order Confirmation - #${order._id}`,
        html: this.getOrderConfirmationHtml(order),
        text: this.getOrderConfirmationText(order),
        headers: {
          'X-Priority': '1',
          'X-MSMail-Priority': 'High'
        }
      };

      const customerResult = await this.sendEmail(customerMail);
      console.log('Customer email result:', customerResult);

      // Admin email
      const adminMail = {
        to: adminEmail,
        subject: `[ACTION REQUIRED] New Order #${order._id}`,
        html: this.getAdminOrderHtml(order),
        headers: {
          'X-Priority': '1',
          'X-MSMail-Priority': 'High'
        }
      };

      const adminResult = await this.sendEmail(adminMail);
      console.log('Admin email result:', adminResult);

      return { customerResult, adminResult };
    } catch (error) {
      console.error('Order confirmation email failed:', {
        orderId: order._id,
        error: {
          message: error.message,
          stack: error.stack,
          response: error.response,
          code: error.code
        }
      });
      throw error;
    }
  }

  getAdminOrderHtml(order) {
    return `
      <div style="font-family: Arial, sans-serif; max-width: 700px; margin: 0 auto;">
        <h2 style="color: #d32f2f; border-bottom: 1px solid #d32f2f; padding-bottom: 8px;">
          📦 New Order #${order._id}
        </h2>
        ${this.getOrderDetailsTable(order, true)}
        ${order.source === 'REFERRAL' ? `
          <div style="margin-top: 20px; background: #f5f5f5; padding: 15px; border-radius: 5px;">
            <h3 style="margin-top: 0;">Referral Information</h3>
            <p><strong>Referral Code:</strong> ${order.referralCode}</p>
            <p><strong>Commission:</strong> ${this.formatCurrency(order.partnerCommission)}</p>
          </div>
        ` : ''}
        <div style="margin-top: 30px; text-align: center;">
          <a href="${process.env.ADMIN_DASHBOARD_URL}/orders/${order._id}" 
             style="background: #d32f2f; color: white; padding: 10px 15px; text-decoration: none; border-radius: 4px;">
            View Order in Dashboard
          </a>
        </div>
      </div>
    `;
  }

  getOrderConfirmationHtml(order) {
    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #2c3e50;">Order Confirmation</h2>
        <p>Thank you for your order. Here are your order details:</p>
        
        ${this.getOrderDetailsTable(order, false)}
        
       
        
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

  async sendPaymentSuccess(order) {
    return this.sendEmail({
      to: order.customerDetails.email,
      subject: `Payment Received - Order #${order._id}`,
      html: this.getPaymentSuccessHtml(order)
    });
  }
}

module.exports = new EmailService();