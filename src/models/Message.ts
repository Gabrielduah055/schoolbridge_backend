import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IMessage extends Document {
  senderType: 'teacher' | 'parent';
  senderId: Types.ObjectId;        // teacher: ref Teacher | parent: ref Student (child)
  recipientType: 'broadcast' | 'individual' | 'teacher';
  targetClass: string;             // e.g. "Basic 1"
  studentId?: Types.ObjectId;      // ref: Student — set for individual & parent→teacher
  teacherId?: Types.ObjectId;      // ref: Teacher — set for recipientType:'teacher'
  message: string;                 // original extracted message
  deliveredTo: Types.ObjectId[];   // studentIds successfully reached (broadcast)
  failedTo: Types.ObjectId[];      // studentIds where parent had no Telegram chatId
  status: 'sent' | 'partial' | 'failed';
  sentAt: Date;
}

const MessageSchema = new Schema<IMessage>(
  {
    senderType: { type: String, enum: ['teacher', 'parent'], required: true },
    senderId: {
      type: Schema.Types.ObjectId,
      refPath: 'senderType',   // dynamic ref: Teacher for teacher, Student for parent
      required: true,
      index: true
    },
    recipientType: { type: String, enum: ['broadcast', 'individual', 'teacher'], required: true },
    targetClass: { type: String, required: true, index: true },
    studentId: {
      type: Schema.Types.ObjectId,
      ref: 'Student',
      default: null
    },
    teacherId: {
      type: Schema.Types.ObjectId,
      ref: 'Teacher',
      default: null
    },
    message: { type: String, required: true },
    deliveredTo: [{ type: Schema.Types.ObjectId, ref: 'Student' }],
    failedTo: [{ type: Schema.Types.ObjectId, ref: 'Student' }],
    status: {
      type: String,
      enum: ['sent', 'partial', 'failed'],
      required: true
    },
    sentAt: { type: Date, default: Date.now, index: true }
  },
  { timestamps: true }
);

export default mongoose.model<IMessage>('Message', MessageSchema);
