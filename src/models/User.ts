import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IUser extends Document {
  name: string;
  phone: string;
  email: string;
  role: 'admin' | 'teacher' | 'parent';
  class?: string;
  subject?: string;
  studentId?: Types.ObjectId;
  telegramChatId?: string;
  isActive: boolean;
  createdAt: Date;
}

const UserSchema = new Schema({
  name: { type: String, required: true },
  phone: { type: String, required: true, unique: true },
  email: { type: String, default: '' },
  role: { 
    type: String, 
    enum: ['admin', 'teacher', 'parent'], 
    required: true 
  },
  class: { type: String, default: '' },
  subject: { type: String, default: '' },
  studentId: { 
    type: Schema.Types.ObjectId, 
    ref: 'Student', 
    default: null 
  },
  telegramChatId: { type: String, default: null, sparse:true, index: true },
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now }
});

export default mongoose.model<IUser>('User', UserSchema);
