import jwt from "jsonwebtoken"; 
import { asyncHandler } from "../utils/asyncHandler.js";
import { User } from "../models/user.model.js";
import { ApiResponse } from "../utils/apiResponse.js";


export const verifyJWT = asyncHandler(async(req,res,next) => {
    try {
        const token = req.header("Authorization")?.replace("Bearer ", "")
        if (!token) {
            return res.status(401).json(new ApiResponse(null, "No access token provided"))
        }
        const decodedToken = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET)
        const user = await User.findById(decodedToken?._id).select("-password")
        if (!user) {
            return res.status(401).json(new ApiResponse(null, "Invalid Access Token"))
        }
        req.user = user;
        next()
    } catch (error) {
        return res.status(401).json(new ApiResponse(null, "Invalid Access Token"))
        
    }
})