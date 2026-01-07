const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const Partner = require('../model/Partner');

// Create Stripe Connect account for partner
exports.createConnectAccount = async (req, res) => {
  try {
    const partner = await Partner.findById(req.partner.id);
    
    if (partner.stripeAccountId) {
      return res.status(400).json({
        success: false,
        message: 'Stripe account already exists'
      });
    }

    const account = await stripe.accounts.create({
      type: 'express',
      country: 'FR', // Change to your country
      email: partner.email,
      capabilities: {
        transfers: { requested: true },
        card_payments: { requested: true },
      },
      business_type: 'individual',
      individual: {
        first_name: partner.name.split(' ')[0],
        last_name: partner.name.split(' ')[1] || '',
        email: partner.email,
      },
      metadata: {
        partnerId: partner._id.toString(),
        referralCode: partner.referralCode
      }
    });

    partner.stripeAccountId = account.id;
    partner.stripeAccountStatus = 'pending';
    await partner.save();

    res.json({
      success: true,
      accountId: account.id,
      message: 'Stripe Connect account created'
    });
  } catch (error) {
    console.error('❌ Create Connect account error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Generate onboarding link
exports.createOnboardingLink = async (req, res) => {
  try {
    const partner = await Partner.findById(req.partner.id);
    
    if (!partner.stripeAccountId) {
      return res.status(400).json({
        success: false,
        message: 'No Stripe account found'
      });
    }

    const accountLink = await stripe.accountLinks.create({
      account: partner.stripeAccountId,
      refresh_url: `${process.env.FRONTEND_URL}/partner/dashboard?refresh=stripe`,
      return_url: `${process.env.FRONTEND_URL}/partner/dashboard?success=stripe`,
      type: 'account_onboarding',
    });

    res.json({
      success: true,
      url: accountLink.url
    });
  } catch (error) {
    console.error('❌ Create onboarding link error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Get partner dashboard link
exports.getDashboardLink = async (req, res) => {
  try {
    const partner = await Partner.findById(req.partner.id);
    
    if (!partner.stripeAccountId) {
      return res.status(400).json({
        success: false,
        message: 'No Stripe account found'
      });
    }

    const loginLink = await stripe.accounts.createLoginLink(
      partner.stripeAccountId
    );

    res.json({
      success: true,
      url: loginLink.url
    });
  } catch (error) {
    console.error('❌ Get dashboard link error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Get account status
exports.getAccountStatus = async (req, res) => {
  try {
    const partner = await Partner.findById(req.partner.id);
    
    if (!partner.stripeAccountId) {
      return res.json({
        success: true,
        hasAccount: false,
        status: 'not_created'
      });
    }

    const account = await stripe.accounts.retrieve(partner.stripeAccountId);

    partner.stripeAccountStatus = account.charges_enabled ? 'active' : 'pending';
    partner.stripeOnboardingCompleted = account.details_submitted;
    await partner.save();

    res.json({
      success: true,
      hasAccount: true,
      status: account.charges_enabled ? 'active' : 'pending',
      detailsSubmitted: account.details_submitted,
      payoutsEnabled: account.payouts_enabled,
      requirements: account.requirements,
      accountId: partner.stripeAccountId
    });
  } catch (error) {
    console.error('❌ Get account status error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Create direct payment link (for admin testing)
exports.createPaymentLink = async (req, res) => {
  try {
    const { amount, currency = 'eur', partnerId } = req.body;
    
    const config = {
      line_items: [
        {
          price_data: {
            currency: currency,
            product_data: {
              name: 'Test Payment',
              description: 'Test Stripe Connect payment'
            },
            unit_amount: Math.round(amount * 100),
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
    };

    // If partner has Stripe Connect, split payment
    if (partnerId) {
      const partner = await Partner.findById(partnerId);
      if (partner?.stripeAccountId && partner?.stripeAccountStatus === 'active') {
        const commission = amount * 0.1; // 10% commission
        const platformFee = amount - commission;
        
        config.payment_intent_data = {
          application_fee_amount: Math.round(platformFee * 100),
          transfer_data: {
            destination: partner.stripeAccountId,
          },
        };
      }
    }

    const session = await stripe.checkout.sessions.create(config);

    res.json({
      success: true,
      url: session.url
    });
  } catch (error) {
    console.error('❌ Create payment link error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};