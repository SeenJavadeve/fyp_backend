import mongoose, { Schema } from "mongoose";

const subscriptionSchema = new Schema({
  user_id: {
    type: Schema.Types.ObjectId,
    ref: "User",
    required: true,
    unique: true
  },
  issue_date: {
    type: Date,
    required: true,
    default: Date.now
  },
  expiry_date: {
    type: Date,
    required: true
  },
  status: {
    type: String,
    enum: ["active", "cancelled", "expired"],
    default: "active",
    required: true
  },
  transaction_id: {
    type: String,
    required: true,
    unique: true
  },
  amount_paid: {
    type: Number,
    required: true,
    min: 0
  },
  payment_method: {
    type: String,
    enum: ["credit_card", "debit_card", "paypal", "stripe", "bank_transfer", "cash", "other"],
    required: true
  },
  auto_renew: {
    type: Boolean,
    default: false
  },
  cancelled_date: {
    type: Date
  },
  cancelled_reason: {
    type: String,
    maxlength: 500
  }
}, {
  timestamps: true,
});

// Index for efficient queries
subscriptionSchema.index({ user_id: 1 });
subscriptionSchema.index({ status: 1 });
subscriptionSchema.index({ expiry_date: 1 });

// Instance method to check if subscription is active
subscriptionSchema.methods.isActive = function() {
  return this.status === 'active' && this.expiry_date > new Date();
};

// Instance method to check if subscription is expired
subscriptionSchema.methods.isExpired = function() {
  return this.expiry_date < new Date();
};

// Instance method to get days remaining
subscriptionSchema.methods.getDaysRemaining = function() {
  const now = new Date();
  const diffTime = this.expiry_date - now;
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays > 0 ? diffDays : 0;
};

// Instance method to cancel subscription
subscriptionSchema.methods.cancelSubscription = function(reason) {
  this.status = 'cancelled';
  this.cancelled_date = new Date();
  this.auto_renew = false;
  if (reason) {
    this.cancelled_reason = reason;
  }
  return this.save();
};

// Pre-save middleware to auto-update status based on expiry date
subscriptionSchema.pre('save', function(next) {
  if (this.expiry_date && this.expiry_date < new Date() && this.status === 'active') {
    this.status = 'expired';
  }
  next();
});

export const Subscription = mongoose.model("Subscription", subscriptionSchema);
