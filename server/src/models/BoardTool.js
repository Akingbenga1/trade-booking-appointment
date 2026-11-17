import mongoose from 'mongoose';

const boardToolSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, maxlength: 80 },
    detail: { type: String, required: true, maxlength: 400 },
    category: { type: String, required: true, maxlength: 80 },
  },
  { timestamps: true }
);

export const BoardTool = mongoose.model('BoardTool', boardToolSchema);
