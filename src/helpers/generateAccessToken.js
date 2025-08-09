import { User } from '../models/user.model.js'



const generateAccessToken = async(userId) =>{
    try {
        const user = await User.findById(userId)
        const accessToken = user.generateAccessToken()
        await user.save({ validateBeforeSave: false })
        return {accessToken}

    } catch (error) {
        return res.status(500).json(new ApiResponse(null, "Something went wrong while generating access token"))
    }
}

export {generateAccessToken};