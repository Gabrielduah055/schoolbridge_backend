import { Types } from 'mongoose';

export type CommunicationChannel = 'telegram' | 'whatsapp' | 'dashboard';
export type ParticipantRole = 'parent' | 'teacher' | 'admin' | 'visitor' | 'unregistered';

export interface NormalizedInboundMessage {
  schoolId: string;
  channel: CommunicationChannel;
  provider: string;
  externalChatId: string;
  externalUserId: string;
  text: string;
  senderName: string;
  participantPhone?: string;
  providerMessageId?: string;
  rawPayload?: Record<string, unknown>;
}

export interface ResolvedSender {
  role: ParticipantRole;
  name: string;
  phone: string;
  parentId?: Types.ObjectId;
  teacherId?: Types.ObjectId;
  studentId?: Types.ObjectId;
  classId?: Types.ObjectId;
  className?: string;
}

export interface OutgoingCommunicationResponse {
  conversationId: Types.ObjectId;
  incomingMessageId: Types.ObjectId;
  outgoingMessageId?: Types.ObjectId;
  handoverTicketId?: Types.ObjectId;
  body: string;
  channel: CommunicationChannel;
  provider: string;
}

