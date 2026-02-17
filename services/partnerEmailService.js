// services/partnerEmailService.js
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: process.env.EMAIL_PORT,
  secure: true,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

exports.sendPartnerCommissionNotification = async (partner, data) => {
  try {
    const { orderId, amount, type, date } = data;
    
    const subject = type === 'instant_transfer' 
      ? `💰 €${amount} Commission Instantly Transferred!`
      : `💰 €${amount} Commission Earned`;
    
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
          .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
          .amount { font-size: 48px; font-weight: bold; color: #10b981; margin: 20px 0; }
          .info-box { background: white; border-left: 4px solid #667eea; padding: 15px; margin: 20px 0; border-radius: 4px; }
          .footer { text-align: center; margin-top: 30px; color: #666; font-size: 12px; }
          .button { display: inline-block; background: #667eea; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; font-weight: bold; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>💰 Commission Update</h1>
            <p>${type === 'instant_transfer' ? 'Instant Transfer Complete!' : 'New Commission Earned'}</p>
          </div>
          
          <div class="content">
            <div style="text-align: center;">
              <div class="amount">€${amount}</div>
              <p>${type === 'instant_transfer' ? 'has been instantly transferred to your Stripe account!' : 'commission earned from referral!'}</p>
            </div>
            
            <div class="info-box">
              <p><strong>Order ID:</strong> ${orderId}</p>
              <p><strong>Transfer Type:</strong> ${type === 'instant_transfer' ? 'Instant Stripe Transfer' : 'Standard Commission'}</p>
              <p><strong>Date:</strong> ${date.toLocaleDateString('fr-FR')}</p>
              <p><strong>Time:</strong> ${date.toLocaleTimeString('fr-FR')}</p>
            </div>
            
            ${type === 'instant_transfer' ? `
            <div style="text-align: center; margin: 30px 0;">
              <p>💰 The €400 is now in your Stripe account and available for withdrawal!</p>
              <a href="https://dashboard.stripe.com/connect/accounts/${partner.stripeConnect?.accountId}" class="button">
                View Your Stripe Balance
              </a>
            </div>
            ` : ''}
            
            <div style="text-align: center; margin-top: 30px;">
              <a href="${process.env.FRONTEND_URL}/partner/dashboard" class="button">
                Go to Dashboard
              </a>
            </div>
          </div>
          
          <div class="footer">
            <p>This is an automated notification from ${process.env.COMPANY_NAME || 'Ouvrir Societe Hong Kong'}</p>
            <p>If you have any questions, contact support: ${process.env.SUPPORT_EMAIL}</p>
          </div>
        </div>
      </body>
      </html>
    `;
    
    await transporter.sendMail({
      from: `"${process.env.COMPANY_NAME || 'Commission System'}" <${process.env.EMAIL_USER}>`,
      to: partner.email,
      subject: subject,
      html: html
    });
    
    console.log(`✅ Commission notification sent to ${partner.email}`);
    
  } catch (error) {
    console.error('❌ Email notification error:', error);
  }
};