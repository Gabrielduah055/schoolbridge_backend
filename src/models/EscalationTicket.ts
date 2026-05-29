import mongoose, { Schema, Document } from 'mongoose';

export interface IEscalationTicket extends Document {
  ticketId: string;               // human-readable: ESC-20260529-0001
  chatId: string;
  telegramUserId: string;
  claimedPhone: string | null;    // phone the user claims to own
  claimedStudentName: string;     // child name they say belongs to them
  status: 'pending' | 'approved' | 'rejected' | 'duplicate';
  adminGroupMessageId: number | null; // message ID posted to admin group
  resolvedBy: string;             // admin Telegram username who acted
  resolutionNote: string;
  duplicateOfTicketId: string | null;
  resolvedAt: Date | null;
  expiresAt: Date;                // auto-closed after 7 days if no admin action
  createdAt: Date;
  updatedAt: Date;
}

const EscalationTicketSchema = new Schema<IEscalationTicket>(
  {
    ticketId:      { type: String, required: true, unique: true },
    chatId:        { type: String, required: true },
    telegramUserId:{ type: String, default: '' },
    claimedPhone:  { type: String, default: null },
    claimedStudentName: { type: String, default: '' },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'duplicate'],
      default: 'pending',
      required: true
    },
    adminGroupMessageId:  { type: Number, default: null },
    resolvedBy:           { type: String, default: '' },
    resolutionNote:       { type: String, default: '' },
    duplicateOfTicketId:  { type: String, default: null },
    resolvedAt:           { type: Date,   default: null },
    expiresAt:            { type: Date,   required: true }
  },
  { timestamps: true }
);

// Auto-expire unresolved tickets after 7 days
EscalationTicketSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Query patterns used by admin command handlers
EscalationTicketSchema.index({ ticketId: 1 }, { unique: true });
EscalationTicketSchema.index({ chatId: 1, status: 1 });
EscalationTicketSchema.index({ status: 1, createdAt: -1 });

export default mongoose.model<IEscalationTicket>('EscalationTicket', EscalationTicketSchema);
