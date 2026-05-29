import mongoose, { Schema, Document, Types } from 'mongoose';

export interface ITelegramIdentity extends Document {
  chatId: string;
  telegramUserId: string;
  phone: string;
  status: 'parent' | 'visitor';
  parentUserId?: Types.ObjectId;
  firstName: string;
  lastName: string;
  username: string;
  isVerifiedContact: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const TelegramIdentitySchema = new Schema(
  {
    chatId: { type: String, required: true, unique: true, index: true },
    telegramUserId: { type: String, default: '', index: true },
    phone: { type: String, required: true, index: true },
    status: {
      type: String,
      enum: ['parent', 'visitor'],
      required: true
    },
    parentUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    firstName: { type: String, default: '' },
    lastName: { type: String, default: '' },
    username: { type: String, default: '' },
    isVerifiedContact: { type: Boolean, default: true }
  },
  { timestamps: true }
);

export default mongoose.model<ITelegramIdentity>('TelegramIdentity', TelegramIdentitySchema);
