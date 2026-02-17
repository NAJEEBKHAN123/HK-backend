const nodemailer = require('nodemailer');

class EmailService {
  constructor() {
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASSWORD) {
      console.warn('⚠️ Email service not configured');
      this.transporter = null;
      return;
    }

    this.transporter = nodemailer.createTransport({
      host: process.env.EMAIL_HOST,
      port: parseInt(process.env.EMAIL_PORT),
      secure: false,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD
      },
      tls: {
        rejectUnauthorized: false
      },
      logger: true,
      debug: true,
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 10000
    });

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
      const info = await this.transporter.sendMail({
        ...mailOptions,
        from: mailOptions.from || `"${process.env.EMAIL_FROM_NAME}" <${process.env.EMAIL_FROM}>`,
        replyTo: process.env.EMAIL_FROM
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

    try {
      const customerMail = {
        to: customerEmail,
        subject: `Your Order Confirmation - #${order._id}`,
        html: this.getOrderConfirmationHtml(order),
        text: this.getOrderConfirmationText(order)
      };

      const customerResult = await this.sendEmail(customerMail);

      const adminMail = {
        to: adminEmail,
        subject: `[ACTION REQUIRED] New Order #${order._id}`,
        html: this.getAdminOrderHtml(order),
        text: this.getOrderConfirmationText(order)
      };

      const adminResult = await this.sendEmail(adminMail);

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

  async sendPaymentSuccess(order) {
    return this.sendEmail({
      to: order.customerDetails.email,
      subject: `Payment Received - Order #${order._id}`,
      html: this.getPaymentSuccessHtml(order),
      text: this.getOrderConfirmationText(order)
    });
  }

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
      `,
      text: `Name: ${name}\nEmail: ${email}\nPhone: ${phone || 'N/A'}\nMessage: ${message}`
    });
  }

  async sendConfirmationEmail({ name, email }) {
    return this.sendEmail({
      to: email,
      subject: 'We received your message',
      html: `
        <h3>Hi ${name},</h3>
        <p>Thanks for reaching out. We have received your message and will get back to you shortly.</p>
        <p>Regards,<br/>${process.env.EMAIL_FROM_NAME}</p>
      `,
      text: `Hi ${name},\nThanks for reaching out. We have received your message and will get back to you shortly.\n\nRegards,\n${process.env.EMAIL_FROM_NAME}`
    });
  }

  // Update your getOrderConfirmationHtml method:
getOrderConfirmationHtml(order) {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
      <title>Order Confirmation #${order._id}</title>
      <style>
        /* Inline all CSS */
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { color: #2c3e50; border-bottom: 1px solid #eee; padding-bottom: 10px; }
        .footer { font-size: 12px; color: #777; border-top: 1px solid #eee; padding-top: 10px; margin-top: 20px; }
        table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        th, td { padding: 12px; border: 1px solid #ddd; text-align: left; }
        th { background-color: #f9f9f9; }
        .button { background-color: #4CAF50; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px; }
      </style>
    </head>
    <body>
      <div class="header">
        <h2>Order Confirmation</h2>
      </div>
      <p>Dear ${order.customerDetails.fullName},</p>
      <p>Thank you for your order with <strong>Ouvrir Société Hong Kong</strong>. Here are your order details:</p>
      
      ${this.getOrderDetailsTable(order, false)}
      
      <p>Next steps in your order process:</p>
      <ol>
        <li>We've received your order</li>
        <li>Our team is reviewing your details</li>
        <li>We'll contact you within 24 hours</li>
      </ol>
      
      <p>If you have any questions, please reply to this email or contact us at <a href="mailto:bonjour@ouvrir-societe-hong-kong.fr">bonjour@ouvrir-societe-hong-kong.fr</a>.</p>
      
      <div class="footer">
        <p>© ${new Date().getFullYear()} Ouvrir Société Hong Kong. All rights reserved.</p>
        <p>
          <a href="https://ouvrir-societe-hong-kong.fr/contact">Contact Us</a> | 
          <a href="https://ouvrir-societe-hong-kong.fr/legal/privacy">Privacy Policy</a> | 
        </p>
      </div>
    </body>
    </html>
  `;
}

  getAdminOrderHtml(order) {
    return `
      <div style="font-family: Arial, sans-serif; max-width: 700px; margin: 0 auto;">
        <h2 style="color: #d32f2f;">📦 New Order #${order._id}</h2>
        ${this.getOrderDetailsTable(order, true)}
        ${
          order.source === 'REFERRAL'
            ? `<div style="margin-top: 20px;">
                <h3>Referral Info</h3>
                <p><strong>Referral Code:</strong> ${order.referralCode}</p>
                <p><strong>Commission:</strong> ${this.formatCurrency(order.partnerCommission)}</p>
              </div>`
            : ''
        }
      </div>
    `;
  }

  // Add this method to your EmailService class

getPaymentSuccessHtml(order) {
  const { customerDetails, finalPrice, plan } = order;
  const amountPaid = finalPrice ? finalPrice / 100 : 0;
  
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Payment Successful - Order #${order._id}</title>
      <style>
        body {
          font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
          line-height: 1.6;
          color: #333;
          max-width: 600px;
          margin: 0 auto;
          padding: 20px;
          background-color: #f8f9fa;
        }
        .header {
          background: linear-gradient(135deg, #4CAF50 0%, #45a049 100%);
          color: white;
          padding: 30px 20px;
          text-align: center;
          border-radius: 8px 8px 0 0;
        }
        .header h1 {
          margin: 0;
          font-size: 28px;
          font-weight: 600;
        }
        .content {
          background: white;
          padding: 30px;
          border-radius: 0 0 8px 8px;
          box-shadow: 0 2px 10px rgba(0,0,0,0.05);
        }
        .amount-display {
          background: #f0f9f0;
          border: 2px solid #4CAF50;
          border-radius: 8px;
          padding: 20px;
          text-align: center;
          margin: 25px 0;
        }
        .amount {
          font-size: 36px;
          color: #4CAF50;
          font-weight: bold;
          margin: 10px 0;
        }
        .order-details {
          background: #f8f9fa;
          padding: 20px;
          border-radius: 6px;
          margin: 25px 0;
          border-left: 4px solid #4CAF50;
        }
        .detail-row {
          display: flex;
          justify-content: space-between;
          padding: 8px 0;
          border-bottom: 1px solid #eee;
        }
        .detail-row:last-child {
          border-bottom: none;
        }
        .detail-label {
          font-weight: 600;
          color: #555;
        }
        .detail-value {
          color: #333;
        }
        .next-steps {
          background: #e8f4fd;
          padding: 20px;
          border-radius: 6px;
          margin: 25px 0;
          border-left: 4px solid #2196F3;
        }
        .next-steps h3 {
          color: #2196F3;
          margin-top: 0;
        }
        .next-steps ol {
          margin: 0;
          padding-left: 20px;
        }
        .next-steps li {
          margin-bottom: 10px;
        }
        .footer {
          text-align: center;
          margin-top: 30px;
          color: #666;
          font-size: 14px;
          padding-top: 20px;
          border-top: 1px solid #eee;
        }
        .contact-info {
          background: #f8f9fa;
          padding: 15px;
          border-radius: 6px;
          margin: 20px 0;
          text-align: center;
        }
        .button {
          display: inline-block;
          background: #4CAF50;
          color: white;
          padding: 12px 30px;
          text-decoration: none;
          border-radius: 6px;
          font-weight: 600;
          margin-top: 10px;
        }
        .button:hover {
          background: #45a049;
        }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>✅ Payment Successful!</h1>
        <p>Thank you for your purchase</p>
      </div>
      
      <div class="content">
        <p>Hello <strong>${customerDetails.fullName}</strong>,</p>
        
        <p>We're pleased to confirm that your payment has been successfully processed. Your company formation process is now underway!</p>
        
        <div class="amount-display">
          <p style="margin: 0; color: #666; font-size: 14px;">Amount Paid</p>
          <div class="amount">€${amountPaid.toFixed(2)}</div>
          <p style="margin: 0; color: #666; font-size: 14px;">EUR</p>
        </div>
        
        <div class="order-details">
          <h3 style="margin-top: 0; color: #4CAF50;">Order Details</h3>
          
          <div class="detail-row">
            <span class="detail-label">Order ID:</span>
            <span class="detail-value">${order._id}</span>
          </div>
          
          <div class="detail-row">
            <span class="detail-label">Plan:</span>
            <span class="detail-value">${plan} Package</span>
          </div>
          
          <div class="detail-row">
            <span class="detail-label">Customer Name:</span>
            <span class="detail-value">${customerDetails.fullName}</span>
          </div>
          
          <div class="detail-row">
            <span class="detail-label">Customer Email:</span>
            <span class="detail-value">${customerDetails.email}</span>
          </div>
          
          <div class="detail-row">
            <span class="detail-label">Payment Date:</span>
            <span class="detail-value">${new Date().toLocaleDateString('en-GB', {
              day: 'numeric',
              month: 'long',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit'
            })}</span>
          </div>
          
          <div class="detail-row">
            <span class="detail-label">Transaction Reference:</span>
            <span class="detail-value">${order.stripe?.paymentIntentId || order._id}</span>
          </div>
        </div>
        
        <div class="next-steps">
          <h3>📋 What Happens Next?</h3>
          <ol>
            <li><strong>Document Review:</strong> Our team is reviewing your uploaded ID documents</li>
            <li><strong>Company Registration:</strong> We'll begin the Hong Kong company registration process</li>
            <li><strong>Bank Account Setup:</strong> We'll assist with opening your corporate bank account</li>
            <li><strong>Regular Updates:</strong> You'll receive updates at each stage of the process</li>
            <li><strong>Completion:</strong> Your complete company package will be delivered within 2-3 weeks</li>
          </ol>
        </div>
        
        <div class="contact-info">
          <p><strong>Need Help?</strong></p>
          <p>Our team is here to assist you every step of the way.</p>
          <a href="mailto:bonjour@ouvrir-societe-hong-kong.fr" class="button">
            Contact Support
          </a>
        </div>
        
        <p>You can also track your order status by replying to this email.</p>
        
        <p>Best regards,<br>
        <strong>The Ouvrir Société Hong Kong Team</strong></p>
      </div>
      
      <div class="footer">
        <p>This is an automated message. Please do not reply to this email.</p>
        <p>Ouvrir Société Hong Kong<br>
        <a href="https://ouvrir-societe-hong-kong.fr" style="color: #4CAF50; text-decoration: none;">ouvrir-societe-hong-kong.fr</a></p>
        <p>© ${new Date().getFullYear()} Ouvrir Société Hong Kong. All rights reserved.</p>
      </div>
    </body>
    </html>
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
Order Confirmation #${order._id}
=================================

Dear ${order.customerDetails.fullName},

Thank you for your order with Ouvrir Société Hong Kong. Here are your order details:

Order ID: ${order._id}
Plan: ${order.plan}
Amount: ${this.formatCurrency(order.originalPrice)}
Date: ${new Date(order.createdAt).toLocaleString()}

Next steps:
1. We've received your order
2. Our team is reviewing your details
3. We'll contact you within 24 hours

If you have any questions, please reply to this email or contact us at bonjour@ouvrir-societe-hong-kong.fr.

---
Ouvrir Société Hong Kong
https://ouvrir-societe-hong-kong.fr

Contact Us: https://ouvrir-societe-hong-kong.fr/contact
Privacy Policy: https://ouvrir-societe-hong-kong.fr/privacy
Unsubscribe: https://ouvrir-societe-hong-kong.fr/unsubscribe
  `;
}

  formatCurrency(amount) {
    return `€${amount.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
  }
}

module.exports = new EmailService();
