import { Schema, model, Document } from 'mongoose';

export const USER_ROLES = {
  SUPER_ADMIN: 'super_admin',
  PRINCIPAL: 'principal',
  TEACHER: 'teacher',
  STUDENT: 'student',
} as const;

export type UserRole = (typeof USER_ROLES)[keyof typeof USER_ROLES];

export const SUPER_ADMIN_BOOTSTRAP_INDEX = {
  name: 'unique_super_admin_bootstrap',
  unique: true,
  partialFilterExpression: { bootstrapKey: { $type: 'string' } },
} as const;

export interface IUser extends Document {
  schoolId?: Schema.Types.ObjectId;
  fullName: string;
  email: string;
  phone?: string;
  password: string;
  role: UserRole;
  branchId?: Schema.Types.ObjectId;
  isActive: boolean;
  bootstrapKey?: 'super-admin';
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<IUser>(
  {
    schoolId: {
      type: Schema.Types.ObjectId,
      ref: 'School',
      default: null,
    },

    fullName: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 100,
    },

    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },

    phone: {
      type: String,
      trim: true,
    },

    password: {
      type: String,
      required: true,
      minlength: 6,
    },

    role: {
      type: String,
      enum: Object.values(USER_ROLES),
      required: true,
    },

    branchId: {
      type: Schema.Types.ObjectId,
      ref: 'Branch',
      default: null,
    },

    isActive: {
      type: Boolean,
      default: true,
    },

    // Internal singleton marker; ordinary provisioned users have no marker.
    bootstrapKey: {
      type: String,
      enum: ['super-admin'],
      immutable: true,
      select: false,
    },
  },
  {
    timestamps: true,
  },
);

userSchema.index({ bootstrapKey: 1 }, SUPER_ADMIN_BOOTSTRAP_INDEX);

const User = model<IUser>('User', userSchema);

export default User;
