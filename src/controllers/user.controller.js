import bcrypt from "bcrypt";
import { User } from '../models/user.model.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { generateAccessToken } from '../helpers/generateAccessToken.js';
import { ApiResponse } from '../utils/apiResponse.js';
import { isValidEmail, isValidUsername, isValidPassword,isPasswordConfirmPasswordMatch,isValidPhoneNumber,isValidObjectId } from '../utils/regex_validation.js';



const registerUser = asyncHandler(async (req, res) => {
  const { full_name, email, phone_number, password, confirm_password } = req.body;

  const fields = { full_name, email,phone_number, password, confirm_password };

  for (const [key, value] of Object.entries(fields)) {
    if (!value) {
      return res
        .status(400)
        .json(new ApiResponse(null, `${key} is required`));
    }
  }

  if (!isValidEmail(email)) {
    return res.status(400).json(new ApiResponse(null, "Please provide a valid email address"));
  }

  if (!isValidPhoneNumber(phone_number)) {
    return res.status(400).json(new ApiResponse(null, "Please provide a valid phone number"));
  }

  if (!isValidPassword(password)) {
    return res.status(400).json(
      new ApiResponse(null, "Password must be at least 8 characters long and include at least one uppercase letter and one number.")
    );
  }
  
  if (!isPasswordConfirmPasswordMatch(password, confirm_password)) {
    return res
      .status(400)
      .json(new ApiResponse(null, "Passwords do not match."));
  }

  const existingUser = await User.findOne({ email });
  if (existingUser) {
    return res.status(400).json(new ApiResponse(null, "Email already in use"));
  }

  const hashPassword = await bcrypt.hash(password, 10);

  const newUser = await User.create({
    full_name,
    email,
    phone_number,
    password: hashPassword,
  });


  res.status(201).json(new ApiResponse(newUser, "Account created successfully"));
});

const updateUser = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const {
    full_name,
    email,
    phone_number,
  } = req.body;

  const user = await User.findById(userId);
  if (!user) {
    return res.status(404).json(new ApiResponse(null, "User not found"));
  }

  if (user.is_deleted === "y") {
    return res.status(403).json(new ApiResponse(null, "Cannot update deleted account"));
  }

  const fields = { full_name, email, phone_number };
  for (const [key, value] of Object.entries(fields)) {
    if (!value) {
      return res.status(400).json(new ApiResponse(null, `${key} is required`));
    }
  }

  if (!isValidEmail(email)) {
    return res.status(400).json(new ApiResponse(null, "Please provide a valid email address"));
  }


  if (!isValidPhoneNumber(phone_number)) {
    return res.status(400).json(new ApiResponse(null, "Please provide a valid phone number"));
  }

  if (email !== user.email) {
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json(new ApiResponse(null, "Email already in use with another account"));
    }
    user.email = email;
  }

  user.full_name = full_name;
  user.phone_number = phone_number;
  await user.save();
  res.status(200).json(new ApiResponse(user, "User updated successfully"));
  
});




const loginUser = asyncHandler(async (req, res) => {
  const { email, password } = req.body;


  if (!email || !password) {
    return res.status(400).json(new ApiResponse(null, "Email and password are required"));
  }


  if (!isValidEmail(email)) {
    return res.status(400).json(new ApiResponse(null, "Please provide a valid email address"));
  }

  const user = await User.findOne({ email });
  if (!user) {
    return res.status(404).json(new ApiResponse(null, "User does not exist"));
  }
  if (user.is_deleted === "y") {
    return res.status(403).json(new ApiResponse(null, "This account has been deleted"));
  }

  const isPasswordValid = await user.isPasswordCorrect(password);

  if (!isPasswordValid) {
    return res.status(401).json(new ApiResponse(null, "Invalid Credentials Password is Incorrect!"));
  }

  const { accessToken } = await generateAccessToken(user._id);
  const loggedInUser = await User.findById(user._id).select("-password");

  return res
    .status(200)
    .json(
      new ApiResponse(
        {
          user: loggedInUser,
          accessToken
        },
        "User Logged In Successfully"
      )
    );
});

const deleteUser = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  
  const user = await User.findById(userId);
  if (!user) {
    return res.status(404).json(new ApiResponse(null, "User not found"));
  }

  if (user.is_deleted === "y") {
    return res.status(400).json(new ApiResponse(null, "User is already deleted"));
  }

  await User.findByIdAndUpdate(userId, { is_deleted: "y" });
  
  return res
    .status(200)
    .json(new ApiResponse(null, "User deleted successfully"));
});


const getCurrentUser = asyncHandler(async (req, res) => {
  if (req.user.is_deleted === "y") {
    return res.status(403).json(new ApiResponse(null, "User account is deleted"));
  }

  return res.status(200).json(
    new ApiResponse(req?.user, "User fetched successfully")
  );
});


const changePassword = asyncHandler(async (req, res) => {
  const { oldPassword, newPassword } = req.body;


  if (!oldPassword || !newPassword) {
    return res.status(400).json(new ApiResponse(null, "Old password and new password are required"));
  }

  if (!isValidPassword(newPassword)) {
    return res.status(400).json(new ApiResponse(null, "Password must be at least 8 characters long and include at least one uppercase,lowercase letter and one number."));
  }

  const user = await User.findById(req.user?._id);
  if (!user) {
    return res.status(404).json(new ApiResponse(null, "User not found"));
  }

  const isPasswordCorrect = await user.isPasswordCorrect(oldPassword);
  if (!isPasswordCorrect) {
    return res.status(400).json(new ApiResponse(null, "Invalid old password"));
  }

  user.password = await bcrypt.hash(newPassword, 10);
  await user.save({ validateBeforeSave: false });

  return res
    .status(200)
    .json(new ApiResponse(null, "Password changed successfully"));
});


const logoutUser = asyncHandler(async (req, res) => {
  return res.status(200).json(new ApiResponse(null, "Logged out successfully"));
});





const restoreUser = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  
  const user = await User.findById(userId);
  if (!user) {
    return res.status(404).json(new ApiResponse(null, "User not found"));
  }

  if (user.is_deleted === "n") {
    return res.status(400).json(new ApiResponse(null, "User is already active"));
  }

  user.is_deleted = "n";
  await user.save();

  return res
    .status(200)
    .json(new ApiResponse(null, "Account restored successfully"));
});


export {
  loginUser,
  registerUser,
  updateUser,
  deleteUser,
  changePassword,
  getCurrentUser,
};