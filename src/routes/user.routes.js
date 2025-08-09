import { Router } from "express";
import { changePassword, deleteUser, getCurrentUser, loginUser,  registerUser,  updateUser } from '../controllers/user.controller.js';
import { verifyJWT } from '../middlewares/auth.middleware.js';


const router = Router();

router.route("/register").post(registerUser); 
router.route("/login").post(loginUser);
router.route("/delete").delete(verifyJWT,deleteUser);
router.route("/fetch-user").get(verifyJWT,getCurrentUser);
router.route("/change-password").post(verifyJWT, changePassword);

router.route("/update-profile").put(verifyJWT,updateUser); 



export { router as userRoutes };