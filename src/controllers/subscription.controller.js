import { asyncHandler } from "../utils/asyncHandler.js";
import { User } from "../models/user.model.js";
import { Subscription } from "../models/subscription.model.js";
import { ApiResponse } from "../utils/apiResponse.js";

// Get user subscription status
const getSubscriptionStatus = asyncHandler(async (req, res) => {
  const user_id = req.user._id;

  const user = await User.findById(user_id).populate('subscription_id');

  if (!user) {
    return res.status(404).json(new ApiResponse(null, "User not found"));
  }

  const response = {
    user_id: user._id,
    username: user.username,
    email: user.email,
    business_name: user.business_name,
    is_premium: user.is_premium,
    plan_type: user.is_premium ? 'premium' : 'free',
    has_ads: !user.is_premium, // Free users get ads
    subscription: user.subscription_id ? {
      id: user.subscription_id._id,
      issue_date: user.subscription_id.issue_date,
      expiry_date: user.subscription_id.expiry_date,
      status: user.subscription_id.status,
      days_remaining: user.subscription_id.getDaysRemaining(),
      is_active: user.subscription_id.isActive(),
      auto_renew: user.subscription_id.auto_renew
    } : null
  };

  return res.status(200).json(new ApiResponse(response, "Subscription status fetched successfully"));
});

// Upgrade to premium (create subscription)
const upgradeToPremium = asyncHandler(async (req, res) => {
  const user_id = req.user._id;
  const { 
    transaction_id, 
    amount_paid, 
    payment_method, 
    duration_months = 12,
    auto_renew = false 
  } = req.body;

  // Validate required fields
  if (!transaction_id || !amount_paid || !payment_method) {
    return res.status(400).json(new ApiResponse(null, "Transaction ID, amount paid, and payment method are required"));
  }

  if (amount_paid <= 0) {
    return res.status(400).json(new ApiResponse(null, "Amount paid must be greater than 0"));
  }

  const user = await User.findById(user_id);

  if (!user) {
    return res.status(404).json(new ApiResponse(null, "User not found"));
  }

  if (user.is_premium) {
    return res.status(400).json(new ApiResponse(null, "User is already premium"));
  }

  // Check if transaction ID already exists
  const existingTransaction = await Subscription.findOne({ transaction_id });
  if (existingTransaction) {
    return res.status(400).json(new ApiResponse(null, "Transaction ID already exists"));
  }

  // Calculate expiry date
  const issueDate = new Date();
  const expiryDate = new Date();
  expiryDate.setMonth(expiryDate.getMonth() + duration_months);

  // Create subscription
  const subscription = await Subscription.create({
    user_id,
    issue_date: issueDate,
    expiry_date: expiryDate,
    status: 'active',
    transaction_id,
    amount_paid,
    payment_method,
    auto_renew
  });

  // Update user to premium
  user.is_premium = true;
  user.subscription_id = subscription._id;
  await user.save();

  const response = {
    user_id: user._id,
    username: user.username,
    email: user.email,
    is_premium: user.is_premium,
    plan_type: 'premium',
    has_ads: false,
    subscription: {
      id: subscription._id,
      issue_date: subscription.issue_date,
      expiry_date: subscription.expiry_date,
      status: subscription.status,
      days_remaining: subscription.getDaysRemaining(),
      transaction_id: subscription.transaction_id,
      amount_paid: subscription.amount_paid
    }
  };

  return res.status(200).json(new ApiResponse(response, "Successfully upgraded to premium"));
});

// Cancel subscription (downgrade to free)
const cancelSubscription = asyncHandler(async (req, res) => {
  const user_id = req.user._id;
  const { reason } = req.body;

  const user = await User.findById(user_id).populate('subscription_id');

  if (!user) {
    return res.status(404).json(new ApiResponse(null, "User not found"));
  }

  if (!user.is_premium || !user.subscription_id) {
    return res.status(400).json(new ApiResponse(null, "User does not have an active premium subscription"));
  }

  // Cancel the subscription
  await user.subscription_id.cancelSubscription(reason);

  // Update user to free
  user.is_premium = false;
  user.subscription_id = undefined;
  await user.save();

  const response = {
    user_id: user._id,
    username: user.username,
    email: user.email,
    is_premium: user.is_premium,
    plan_type: 'free',
    has_ads: true,
    cancelled_date: user.subscription_id?.cancelled_date,
    cancelled_reason: user.subscription_id?.cancelled_reason
  };

  return res.status(200).json(new ApiResponse(response, "Subscription cancelled successfully. User downgraded to free plan."));
});

// Renew subscription
const renewSubscription = asyncHandler(async (req, res) => {
  const user_id = req.user._id;
  const { 
    transaction_id, 
    amount_paid, 
    payment_method, 
    duration_months = 12 
  } = req.body;

  // Validate required fields
  if (!transaction_id || !amount_paid || !payment_method) {
    return res.status(400).json(new ApiResponse(null, "Transaction ID, amount paid, and payment method are required"));
  }

  const user = await User.findById(user_id).populate('subscription_id');

  if (!user) {
    return res.status(404).json(new ApiResponse(null, "User not found"));
  }

  if (!user.is_premium || !user.subscription_id) {
    return res.status(400).json(new ApiResponse(null, "User does not have a premium subscription to renew"));
  }

  // Check if transaction ID already exists
  const existingTransaction = await Subscription.findOne({ transaction_id });
  if (existingTransaction) {
    return res.status(400).json(new ApiResponse(null, "Transaction ID already exists"));
  }

  // Calculate new expiry date from current expiry
  const currentExpiry = user.subscription_id.expiry_date;
  const newExpiryDate = new Date(currentExpiry);
  newExpiryDate.setMonth(newExpiryDate.getMonth() + duration_months);

  // Update subscription
  user.subscription_id.expiry_date = newExpiryDate;
  user.subscription_id.status = 'active';
  user.subscription_id.transaction_id = transaction_id;
  user.subscription_id.amount_paid = amount_paid;
  user.subscription_id.payment_method = payment_method;
  await user.subscription_id.save();

  const response = {
    user_id: user._id,
    username: user.username,
    email: user.email,
    is_premium: user.is_premium,
    plan_type: 'premium',
    has_ads: false,
    subscription: {
      id: user.subscription_id._id,
      issue_date: user.subscription_id.issue_date,
      expiry_date: user.subscription_id.expiry_date,
      status: user.subscription_id.status,
      days_remaining: user.subscription_id.getDaysRemaining(),
      transaction_id: user.subscription_id.transaction_id,
      amount_paid: user.subscription_id.amount_paid
    }
  };

  return res.status(200).json(new ApiResponse(response, "Subscription renewed successfully"));
});

// Toggle premium status (Admin function)
const togglePremiumStatus = asyncHandler(async (req, res) => {
  const { user_id } = req.params;
  const { make_premium, transaction_id, amount_paid, payment_method } = req.body;

  if (!user_id) {
    return res.status(400).json(new ApiResponse(null, "User ID is required"));
  }

  const user = await User.findById(user_id).populate('subscription_id');

  if (!user) {
    return res.status(404).json(new ApiResponse(null, "User not found"));
  }

  if (make_premium === true) {
    // Upgrade to premium
    if (user.is_premium) {
      return res.status(400).json(new ApiResponse(null, "User is already premium"));
    }

    if (!transaction_id || !amount_paid || !payment_method) {
      return res.status(400).json(new ApiResponse(null, "Transaction details required for premium upgrade"));
    }

    // Create subscription
    const subscription = await Subscription.create({
      user_id,
      issue_date: new Date(),
      expiry_date: new Date(new Date().setFullYear(new Date().getFullYear() + 1)), // 1 year
      status: 'active',
      transaction_id,
      amount_paid,
      payment_method
    });

    user.is_premium = true;
    user.subscription_id = subscription._id;
  } else {
    // Downgrade to free
    if (!user.is_premium) {
      return res.status(400).json(new ApiResponse(null, "User is already on free plan"));
    }

    if (user.subscription_id) {
      await user.subscription_id.cancelSubscription("Admin action");
    }

    user.is_premium = false;
    user.subscription_id = undefined;
  }

  await user.save();

  const response = {
    user_id: user._id,
    username: user.username,
    email: user.email,
    is_premium: user.is_premium,
    plan_type: user.is_premium ? 'premium' : 'free',
    has_ads: !user.is_premium
  };

  const message = user.is_premium ? "User upgraded to premium" : "User downgraded to free";
  return res.status(200).json(new ApiResponse(response, message));
});

// Get all subscriptions (Admin function)
const getAllSubscriptions = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, status } = req.query;

  const filter = {};
  if (status) filter.status = status;

  const subscriptions = await Subscription.find(filter)
    .populate('user_id', 'username email business_name phone_number')
    .sort({ createdAt: -1 })
    .limit(limit * 1)
    .skip((page - 1) * limit);

  const total = await Subscription.countDocuments(filter);

  const response = {
    subscriptions,
    totalPages: Math.ceil(total / limit),
    currentPage: parseInt(page),
    total
  };

  return res.status(200).json(new ApiResponse(response, "All subscriptions fetched successfully"));
});

// Get subscription statistics (Admin function)
const getSubscriptionStats = asyncHandler(async (req, res) => {
  const totalUsers = await User.countDocuments({ is_deleted: "n" });
  const premiumUsers = await User.countDocuments({ 
    is_premium: true,
    is_deleted: "n"
  });
  const freeUsers = totalUsers - premiumUsers;
  
  const activeSubscriptions = await Subscription.countDocuments({ status: 'active' });
  const expiredSubscriptions = await Subscription.countDocuments({ status: 'expired' });
  const cancelledSubscriptions = await Subscription.countDocuments({ status: 'cancelled' });

  const stats = {
    total_users: totalUsers,
    premium_users: premiumUsers,
    free_users: freeUsers,
    premium_percentage: totalUsers > 0 ? ((premiumUsers / totalUsers) * 100).toFixed(2) : 0,
    subscription_breakdown: {
      active: activeSubscriptions,
      expired: expiredSubscriptions,
      cancelled: cancelledSubscriptions
    }
  };

  return res.status(200).json(new ApiResponse(stats, "Subscription statistics fetched successfully"));
});

// Get ads configuration based on user type
const getAdsConfig = asyncHandler(async (req, res) => {
  const user_id = req.user._id;

  const user = await User.findById(user_id);

  if (!user) {
    return res.status(404).json(new ApiResponse(null, "User not found"));
  }

  const adsConfig = {
    show_ads: !user.is_premium,
    user_type: user.is_premium ? 'premium' : 'free',
    ads_settings: {
      banner_ads: !user.is_premium,
      interstitial_ads: !user.is_premium,
      video_ads: !user.is_premium,
      native_ads: !user.is_premium
    }
  };

  return res.status(200).json(new ApiResponse(adsConfig, "Ads configuration fetched successfully"));
});

export {
  getSubscriptionStatus,
  upgradeToPremium,
  cancelSubscription,
  renewSubscription,
  togglePremiumStatus,
  getAllSubscriptions,
  getSubscriptionStats,
  getAdsConfig
};
