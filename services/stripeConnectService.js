import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Initialize Stripe Connect platform
class StripeConnectService {
  // Create a connected account for partner (Express account for quick onboarding)
  async createConnectedAccount(partnerData) {
    try {
      console.log('🔗 Creating Stripe Connect account for:', partnerData.email);
      
      const account = await stripe.accounts.create({
        type: 'express',
        country: partnerData.country || 'FR',
        email: partnerData.email,
        business_type: 'individual',
        individual: {
          first_name: partnerData.name?.split(' ')[0] || partnerData.name,
          last_name: partnerData.name?.split(' ')[1] || '',
          email: partnerData.email,
        },
        capabilities: {
          transfers: { requested: true },
        },
        settings: {
          payouts: {
            schedule: {
              interval: 'manual',
            }
          }
        },
        metadata: {
          partnerId: partnerData._id?.toString(),
          referralCode: partnerData.referralCode
        }
      });
      
      console.log('✅ Stripe Connect account created:', account.id);
      return account;
    } catch (error) {
      console.error('❌ Error creating Stripe account:', error);
      throw error;
    }
  }

  // Create account link for onboarding
  async createAccountLink(accountId, returnUrl, refreshUrl) {
    try {
      const accountLink = await stripe.accountLinks.create({
        account: accountId,
        refresh_url: refreshUrl,
        return_url: returnUrl,
        type: 'account_onboarding',
      });
      return accountLink;
    } catch (error) {
      console.error('❌ Error creating account link:', error);
      throw error;
    }
  }

  // Create login link for partner dashboard
  async createLoginLink(accountId) {
    try {
      const loginLink = await stripe.accounts.createLoginLink(accountId);
      return loginLink;
    } catch (error) {
      console.error('❌ Error creating login link:', error);
      throw error;
    }
  }

  // Check if account is ready for payouts
  async isAccountReady(accountId) {
    try {
      const account = await stripe.accounts.retrieve(accountId);
      return account.charges_enabled && account.payouts_enabled;
    } catch (error) {
      console.error('❌ Error checking account status:', error);
      return false;
    }
  }

  // Transfer commission to partner (€400 per order)
  async transferToPartner(accountId, amount, currency = 'eur') {
    try {
      console.log(`💰 Transferring €${amount/100} to Stripe account: ${accountId}`);
      
      const transfer = await stripe.transfers.create({
        amount: amount, // Already in cents
        currency: currency,
        destination: accountId,
        description: 'Partner commission payout',
        metadata: {
          type: 'commission_payout',
          commissionAmount: amount
        }
      });
      
      console.log('✅ Transfer created:', transfer.id);
      return transfer;
    } catch (error) {
      console.error('❌ Error transferring to partner:', error);
      throw error;
    }
  }

  // Create payout to partner's bank account (instant or standard)
  async createPayout(accountId, amount, currency = 'eur', method = 'standard') {
    try {
      const payout = await stripe.payouts.create({
        amount: amount,
        currency: currency,
        method: method,
        metadata: {
          type: 'commission_payout'
        }
      }, {
        stripeAccount: accountId,
      });
      return payout;
    } catch (error) {
      console.error('❌ Error creating payout:', error);
      throw error;
    }
  }

  // Get account balance
  async getAccountBalance(accountId) {
    try {
      const balance = await stripe.balance.retrieve({
        stripeAccount: accountId,
      });
      return balance;
    } catch (error) {
      console.error('❌ Error getting balance:', error);
      throw error;
    }
  }

  // Update account (for adding bank details, etc)
  async updateAccount(accountId, updates) {
    try {
      const account = await stripe.accounts.update(accountId, updates);
      return account;
    } catch (error) {
      console.error('❌ Error updating account:', error);
      throw error;
    }
  }
}

export default new StripeConnectService();