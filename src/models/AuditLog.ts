import mongoose, { Schema, Document, Types } from 'mongoose';

export type AuditEvent =
  | 'verification_success'
  | 'verification_failed'
  | 'session_created'
  | 'session_expired'
  | 'escalation_raised'
  | 'escalation_resolved'
  | 'access_denied'
  | 'data_accessed'
  | 'admin_action';

export interface IAuditLog extends Document {
  event: AuditEvent;
  chatId: string | null;
  telegramUserId: string | null;
  phone: string | null;
  studentId: Types.ObjectId | null;
  actorRole: 'parent' | 'visitor' | 'admin' | null;
  metadata: Record<string, unknown> | null;
  severity: 'info' | 'warn' | 'security';
  createdAt: Date;
}

const AuditLogSchema = new Schema<IAuditLog>(
  {
    event: {
      type: String,
      enum: [
        'verification_success', 'verification_failed',
        'session_created',      'session_expired',
        'escalation_raised',    'escalation_resolved',
        'access_denied',        'data_accessed',
        'admin_action'
      ],
      required: true
    },
    chatId:        { type: String, default: null },
    telegramUserId:{ type: String, default: null },
    phone:         { type: String, default: null },
    studentId:     { type: Schema.Types.ObjectId, ref: 'Student', default: null },
    actorRole:     { type: String, enum: ['parent', 'visitor', 'admin'], default: null },
    metadata:      { type: Schema.Types.Mixed, default: null },
    severity: {
      type: String,
      enum: ['info', 'warn', 'security'],
      default: 'info',
      required: true
    }
  },
  {
    // AuditLog is append-only — never updated, so updatedAt is pointless
    timestamps: { createdAt: true, updatedAt: false }
  }
);

// Query indexes — most common patterns for admin dashboards / monitoring
AuditLogSchema.index({ chatId: 1, createdAt: -1 });
AuditLogSchema.index({ event: 1,  createdAt: -1 });
AuditLogSchema.index({ severity: 1, createdAt: -1 });

export default mongoose.model<IAuditLog>('AuditLog', AuditLogSchema);
