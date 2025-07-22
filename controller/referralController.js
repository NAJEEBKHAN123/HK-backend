const Partner = require('../model/Partner');
const Client = require('../model/Client');

exports.processReferral = async (req, res, next) => {
  const { referralCode, email } = req.body;
  
  if (referralCode) {
    const partner = await Partner.findOne({ referralCode });
    if (!partner) {
      return res.status(400).json({
        valid: false,
        error: 'Invalid referral code'
      });
    }
    
    // Store in session for later use
    req.referralInfo = {
      partnerId: partner._id,
      referralCode
    };
  }
  
  next();
};

exports.trackConversion = async (orderId) => {
  const order = await Order.findById(orderId).populate('client');
  if (!order.referredBy) return;

  const commission = order.originalPrice * 0.1; // Fixed 10%
  
  await Partner.findByIdAndUpdate(order.referredBy, {
    $inc: { commissionEarned: commission }
  });
};