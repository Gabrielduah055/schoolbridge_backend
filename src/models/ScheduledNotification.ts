import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IScheduledNotification extends Document {
  teacherId: Types.ObjectId;              // ref: Teacher
  teacherChatId: string;                  // teacher's Telegram chatId (for confirmation)
  targetType: 'broadcast' | 'individual';
  targetClass: string;                    // e.g. "Basic 1"
  studentId?: Types.ObjectId;             // ref: Student — only for targetType:'individual'
  studentName?: string;                   // cached name for display
  message: string;
  scheduledFor: Date;                     // UTC datetime — worker fires when <= now
  status: 'pending' | 'sent' | 'failed' | 'cancelled';
  createdAt: Date;
  sentAt?: Date;                          // filled after worker executes
}

const ScheduledNotificationSchema = new Schema<IScheduledNotification>(
  {
    teacherId: {
      type: Schema.Types.ObjectId,
      ref: 'Teacher',
      required: true,
      index: true
    },
    teacherChatId: { type: String, required: true, index: true },
    targetType: {
      type: String,
      enum: ['broadcast', 'individual'],
      required: true
    },
    targetClass: { type: String, required: true },
    studentId: {
      type: Schema.Types.ObjectId,
      ref: 'Student',
      default: null
    },
    studentName: { type: String, default: null },
    message: { type: String, required: true },
    scheduledFor: { type: Date, required: true, index: true },
    status: {
      type: String,
      enum: ['pending', 'sent', 'failed', 'cancelled'],
      default: 'pending',
      index: true
    },
    sentAt: { type: Date, default: null }
  },
  { timestamps: true }
);

// Compound index — the worker's exact query pattern
ScheduledNotificationSchema.index({ status: 1, scheduledFor: 1 });

export default mongoose.model<IScheduledNotification>(
  'ScheduledNotification',
  ScheduledNotificationSchema
);
