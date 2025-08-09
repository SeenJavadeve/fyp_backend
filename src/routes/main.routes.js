import express from 'express';

import {userRoutes} from './user.routes.js';
import subscriptionRoutes from './subscription.routes.js';

const router = express.Router();

router.use('/users', userRoutes);
router.use('/subscription', subscriptionRoutes);
 
export {router as mainRoutes};
