import mongoose, { Schema, Document } from 'mongoose';
import { DEFAULT_SCHOOL_ID } from '../config/school';
import type { Permission } from '../config/permissions';

export type AdminRole = 'super_admin' | 'headmaster' | 'school_admin' | 'teacher';

export interface IAdminUser extends Document {
  name: string;
  email: string;
  passwordHash: string;
  role: AdminRole;
  permissions: Permission[];
  schoolId: string;
  isActive: boolean;
  lastLoginAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const AdminUserSchema = new Schema<IAdminUser>(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    passwordHash: { type: String, required: true },
    role: {
      type: String,
      enum: ['super_admin', 'headmaster', 'school_admin', 'teacher'],
      default: 'headmaster',
      index: true
    },
    permissions: [{ type: String }],
    schoolId: { type: String, default: DEFAULT_SCHOOL_ID, index: true },
    isActive: { type: Boolean, default: true, index: true },
    lastLoginAt: { type: Date, default: null }
  },
  { timestamps: true }
);

AdminUserSchema.index({ schoolId: 1, role: 1 });

export default mongoose.model<IAdminUser>('AdminUser', AdminUserSchema);
