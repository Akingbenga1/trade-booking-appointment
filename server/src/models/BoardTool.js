import mongoose from 'mongoose';

const CATEGORIES = ['tools', 'machines', 'products', 'safety', 'supplies'];

const boardToolSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, maxlength: 80 },
    detail: { type: String, required: true, maxlength: 400 },
    category: { type: String, enum: CATEGORIES, required: true },
  },
  { timestamps: true }
);

export const TOOL_CATEGORIES = CATEGORIES;
export const BoardTool = mongoose.model('BoardTool', boardToolSchema);
