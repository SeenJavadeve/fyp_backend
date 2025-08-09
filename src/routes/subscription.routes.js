import { Router } from "express";
import { verifyJWT } from "../middlewares/auth.middleware.js";
import {
  getSubscriptionStatus,
  upgradeToPremium,
  cancelSubscription,
  renewSubscription,
  togglePremiumStatus,
  getAllSubscriptions,
  getSubscriptionStats,
  getAdsConfig
} from "../controllers/subscription.controller.js";

const router = Router();

// Apply authentication middleware to all routes
router.use(verifyJWT);

// Get user's subscription status
router.get("/status", getSubscriptionStatus);

// Get ads configuration
router.get("/ads-config", getAdsConfig);

// Upgrade to premium
router.post("/upgrade", upgradeToPremium);

// Cancel subscription (downgrade to free)
router.post("/cancel", cancelSubscription);

// Renew subscription
router.post("/renew", renewSubscription);

// Admin routes (you might want to add admin middleware)
router.get("/admin/stats", getSubscriptionStats);
router.get("/admin/all", getAllSubscriptions);
router.patch("/admin/toggle/:user_id", togglePremiumStatus);

export default router;
