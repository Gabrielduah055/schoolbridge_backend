import { Types } from 'mongoose';
import bot from '../../bot/telegram';
import Broadcast from '../../models/Broadcast';
import Message from '../../models/Message';
import MessageRecipient from '../../models/MessageRecipient';
import Student from '../../models/Students';
import Teacher from '../../models/Teacher';
import TelegramIdentity from '../../models/TelegramIdentity';
import { chatWithSchoolAgent } from '../../agents/schoolAgent';
import { DEFAULT_SCHOOL_ID } from '../../config/school';
import { normalizePhoneNumber } from '../../utils/phone';
import { logDelivery } from './deliveryService';

type BroadcastAudience = 'whole_school' | 'class' | 'individual' | 'individual_parent' | 'teachers' | 'parents';

interface CreateDraftArgs {
  schoolId?: string;
  createdBy?: Types.ObjectId;
  createdByRole: 'teacher' | 'admin';
  audienceType: BroadcastAudience;
  classId?: Types.ObjectId;
  targetClass?: string;
  recipientPhone?: string;
  title?: string;
  originalText: string;
  draftedText?: string;
  channels?: Array<'telegram' | 'whatsapp'>;
}

interface RecipientCandidate {
  name: string;
  phone: string;
  role: 'parent' | 'teacher';
  studentId?: Types.ObjectId;
  classId?: Types.ObjectId;
  targetClass?: string;
}

export const createDraft = async ({
  schoolId = DEFAULT_SCHOOL_ID,
  createdBy,
  createdByRole,
  audienceType,
  classId,
  targetClass = '',
  recipientPhone = '',
  title = '',
  originalText,
  draftedText = '',
  channels = ['telegram']
}: CreateDraftArgs) => {
  let finalDraft = draftedText || originalText;

  if (!draftedText) {
    try {
      finalDraft = await chatWithSchoolAgent(
        [{
          role: 'user',
          content: `Polish this school broadcast. Keep it clear, professional, brief, and ready to send:\n\n${originalText}`
        }],
        createdByRole,
        '',
        createdByRole === 'teacher' ? 'Teacher' : 'Admin',
        'fast'
      );
    } catch {
      finalDraft = originalText;
    }
  }

  return Broadcast.create({
    schoolId,
    createdBy,
    createdByRole,
    audienceType,
    classId,
    targetClass,
    recipientPhone,
    title,
    originalText,
    draftedText: finalDraft,
    approvalStatus: 'pending_approval',
    status: 'draft',
    channels: channels.filter((channel) => channel === 'telegram')
  });
};

const uniqueByPhone = (recipients: RecipientCandidate[]) => {
  const byPhone = new Map<string, RecipientCandidate>();
  for (const recipient of recipients) {
    const normalized = normalizePhoneNumber(recipient.phone);
    if (normalized && !byPhone.has(normalized)) {
      byPhone.set(normalized, { ...recipient, phone: normalized });
    }
  }
  return Array.from(byPhone.values());
};

const parentRecipientsFromStudents = async (filter: Record<string, unknown>) => {
  const students = await Student.find({ status: 'active', ...filter }).lean();
  return uniqueByPhone(students
    .filter((student: any) => student.parentPhone)
    .map((student: any) => ({
      name: student.parentName || 'Parent',
      phone: student.parentPhone,
      role: 'parent' as const,
      studentId: student._id,
      targetClass: student.class
    })));
};

const resolveRecipients = async (broadcast: any): Promise<RecipientCandidate[]> => {
  if (broadcast.audienceType === 'class') {
    const targetClass = broadcast.targetClass;
    if (!targetClass) return [];
    return parentRecipientsFromStudents({ class: targetClass });
  }

  if (broadcast.audienceType === 'whole_school' || broadcast.audienceType === 'parents') {
    return parentRecipientsFromStudents({});
  }

  if (broadcast.audienceType === 'individual' || broadcast.audienceType === 'individual_parent') {
    if (!broadcast.recipientPhone) return [];
    return [{ name: 'Parent', phone: broadcast.recipientPhone, role: 'parent' }];
  }

  if (broadcast.audienceType === 'teachers') {
    const teachers = await Teacher.find({ active: true }).lean();
    return uniqueByPhone(teachers.map((teacher: any) => ({
      name: teacher.fullName,
      phone: teacher.phone,
      role: 'teacher' as const
    })));
  }

  return [];
};

export const sendApprovedBroadcast = async (broadcastId: string) => {
  const broadcast = await Broadcast.findById(broadcastId);

  if (!broadcast) {
    throw new Error('Broadcast not found');
  }

  if (broadcast.approvalStatus !== 'approved') {
    throw new Error('Broadcast must be approved before sending');
  }

  if (!broadcast.channels.includes('telegram')) {
    throw new Error('Only Telegram broadcasts are implemented in this MVP');
  }

  broadcast.status = 'sending';
  await broadcast.save();

  const body = broadcast.draftedText || broadcast.originalText;
  const recipients = await resolveRecipients(broadcast);
  let sentCount = 0;
  let failedCount = 0;
  let pendingCount = 0;

  for (const recipient of recipients) {
    const identity = await TelegramIdentity.findOne({
      phone: normalizePhoneNumber(recipient.phone),
      status: recipient.role
    });

    const recipientRow = new MessageRecipient({
      broadcastId: broadcast._id,
      recipientName: recipient.name,
      recipientPhone: normalizePhoneNumber(recipient.phone),
      recipientRole: recipient.role,
      ...(recipient.studentId ? { studentId: recipient.studentId } : {}),
      ...(recipient.classId ? { classId: recipient.classId } : {}),
      channel: 'telegram',
      status: identity ? 'pending' : 'skipped',
      errorMessage: identity ? '' : 'No Telegram identity for recipient'
    });
    await recipientRow.save();

    if (!identity) {
      pendingCount++;
      continue;
    }

    const message = new Message({
      schoolId: broadcast.schoolId || DEFAULT_SCHOOL_ID,
      channel: 'telegram',
      direction: 'outgoing',
      senderRole: broadcast.createdByRole,
      senderName: broadcast.createdByRole === 'teacher' ? 'Teacher' : 'Admin',
      body,
      messageType: 'text',
      aiGenerated: false,
      recipientType: 'broadcast',
      targetClass: recipient.targetClass || broadcast.targetClass || '',
      status: 'queued',
      sentAt: new Date()
    });
    await message.save();

    recipientRow.messageId = message._id as Types.ObjectId;

    try {
      const sent = await bot.sendMessage(identity.chatId, body);
      message.status = 'sent';
      message.providerMessageId = sent.message_id.toString();
      await message.save();

      recipientRow.status = 'sent';
      recipientRow.providerMessageId = sent.message_id.toString();
      await recipientRow.save();

      await logDelivery({
        messageId: message._id as Types.ObjectId,
        broadcastId: broadcast._id as Types.ObjectId,
        recipientId: recipientRow._id as Types.ObjectId,
        schoolId: broadcast.schoolId || DEFAULT_SCHOOL_ID,
        channel: 'telegram',
        provider: 'telegram_bot',
        providerMessageId: sent.message_id.toString(),
        eventType: 'broadcast_sent',
        status: 'sent',
        rawPayload: sent as unknown as Record<string, unknown>
      });

      sentCount++;
    } catch (error: any) {
      message.status = 'failed';
      await message.save();

      recipientRow.status = 'failed';
      recipientRow.errorMessage = error?.message || 'Telegram send failed';
      await recipientRow.save();

      await logDelivery({
        messageId: message._id as Types.ObjectId,
        broadcastId: broadcast._id as Types.ObjectId,
        recipientId: recipientRow._id as Types.ObjectId,
        schoolId: broadcast.schoolId || DEFAULT_SCHOOL_ID,
        channel: 'telegram',
        provider: 'telegram_bot',
        eventType: 'broadcast_failed',
        status: 'failed',
        errorMessage: recipientRow.errorMessage
      });

      failedCount++;
    }
  }

  const totalRecipients = recipients.length;
  broadcast.sentAt = new Date();
  broadcast.status = totalRecipients === 0 || sentCount === 0
    ? 'failed'
    : failedCount > 0 || pendingCount > 0
      ? 'partially_failed'
      : 'sent';
  await broadcast.save();

  return {
    broadcast,
    deliverySummary: {
      totalRecipients,
      sentCount,
      failedCount,
      pendingCount
    }
  };
};
