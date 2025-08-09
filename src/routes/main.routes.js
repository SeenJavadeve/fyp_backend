import express from 'express';

import {userRoutes} from './user.routes.js';
import subscriptionRoutes from './subscription.routes.js';
import fileRoutes from './file.routes.js';

const router = express.Router();

router.use('/users', userRoutes);
router.use('/subscription', subscriptionRoutes);
router.use('/files', fileRoutes);
 
export {router as mainRoutes};
