import { Schema, model } from 'mongoose';
// Physical school resources; never realtime media rooms.
export const ROOM_CATEGORIES = [
  'classroom',
  'science_lab',
  'computer_lab',
  'library',
  'hall',
  'other',
] as const;
const schema = new Schema(
  {
    branchId: {
      type: Schema.Types.ObjectId,
      ref: 'Branch',
      required: true,
      immutable: true,
    },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    code: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      maxlength: 20,
    },
    category: {
      type: String,
      enum: ROOM_CATEGORIES,
      required: true,
      default: 'classroom',
    },
    isActive: { type: Boolean, required: true, default: true },
    revision: { type: Number, required: true, default: 1 },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      immutable: true,
    },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);
schema.index(
  { branchId: 1, code: 1 },
  { unique: true, name: 'unique_branch_room_code' }
);
schema.index(
  { branchId: 1, name: 1 },
  {
    unique: true,
    collation: { locale: 'en', strength: 2 },
    name: 'unique_branch_room_name',
  }
);
export default model('Room', schema);
