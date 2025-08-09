import mongoose, { Schema } from "mongoose";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";

const userSchema = new Schema(
  {
    full_name: {
      type: String,
      required: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
    },
    is_email_verified: {
      type: Boolean,
      required: false,
      default: false,
    },
    password: {
      type: String,
      required: [true, "Password is required"],
    },
    
    phone_number: {
      type: String,
      required:false,
      default: "03123456789",
    },

    is_deleted: {
      type: String,
      enum: ["y", "n"],
      default: "n",
    },
    is_premium: {
      type: Boolean,
      default: false,
    },
    subscription_id: {
      type: Schema.Types.ObjectId,
      ref: "Subscription",
      required: function() {
        return this.is_premium === true;
      }
    },
  },
  {
    timestamps: true,
  }
);

userSchema.methods.isPasswordCorrect = async function (password) {
  return await bcrypt.compare(password, this.password);
};

userSchema.methods.generateAccessToken = function () {
  return jwt.sign(
    {
      _id: this._id,
      email: this.email,
    },
    process.env.ACCESS_TOKEN_SECRET,
    {
      expiresIn: process.env.ACCESS_TOKEN_EXPIRY,
    }
  );
};

export const User = mongoose.model("User", userSchema);



