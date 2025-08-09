import mongoose, { Schema } from 'mongoose';

const fileSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    originalName: { type: String, required: true },
    storedName: { type: String, required: true },
    extension: { type: String, required: true },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true },
    path: { type: String, required: true }, // e.g. /files/<uuid>.csv (relative to public)
    uploadDate: { type: Date, default: Date.now },
    columns: [{ type: String }],
    chartType: { type: String },
  },
  { timestamps: true }
);

fileSchema.virtual('url').get(function () {
  return this.path; // served by express.static('public')
});

export const File = mongoose.model('File', fileSchema);