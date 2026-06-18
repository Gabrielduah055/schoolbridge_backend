import { Types } from 'mongoose';
import bot from '../../bot/telegram';
import Broadcast from '../../models/Broadcast';
import Message from '../../models/Message';
import MessageRecipient from '../../models/MessageRecipient';
import Class from '../../models/Class';
import Student from '../../models/Students';
import Teacher from '../../models/Teacher';
import TelegramIdentity from '../../models/TelegramIdentity';
import { chatWithSchoolAgent } from '../../agents/schoolAgent';
import { DEFAULT_SCHOOL_ID } from '../../config/school';
import { normalizePhoneNumber } from '../../utils/phone';
import { logDelivery } from './deliveryService';
import { findParentTelegramIdentityByPhone } from '../telegramIdentityReconciliationService';
import type { AdminRole } from '../../models/AdminUser';

type BroadcastAudience = 'whole_school' | 'class' | 'individual' | 'individual_parent' | 'teachers' | 'parents';

interface CreateDraftArgs {
  schoolId?: string;
  createdBy?: Types.ObjectId;
  createdByName?: string;
  createdByRole: AdminRole | 'teacher' | 'admin';
  audienceType: BroadcastAudience;
  classId?: Types.ObjectId;
  recipientStudentId?: Types.ObjectId;
  recipientStudentName?: string;
  targetClass?: string;
  recipientPhone?: string;
  title?: string;
  originalText: string;
  draftedText?: string;
  attachments?: BroadcastAttachment[];
  channels?: Array<'telegram' | 'whatsapp'>;
}

interface BroadcastAttachment {
  originalName: string;
  fileName: string;
  filePath: string;
  mimeType: string;
  size: number;
}

interface RecipientCandidate {
  name: string;
  phone: string;
  role: 'parent' | 'teacher';
  studentId?: Types.ObjectId;
  classId?: Types.ObjectId;
  targetClass?: string;
}

interface BroadcastActor {
  id: string;
  name: string;
  role: AdminRole;
}

export interface RecipientPreviewItem {
  name: string;
  role: 'parent' | 'teacher';
  phone: string;
  studentName: string;
  className: string;
  telegramLinked: boolean;
  telegramChatId: string | null;
  canReceiveNow: boolean;
  reasonIfNotReachable: string | null;
}

export interface RecipientPreview {
  audienceType: BroadcastAudience;
  totalContacts: number;
  telegramReachable: number;
  telegramMissing: number;
  whatsappReachable: 0;
  whatsappMissing: 0;
  reachableNow: number;
  unreachableNow: number;
  recipients: RecipientPreviewItem[];
}

export const cleanBroadcastText = (value: string) => {
  const text = value
    .replace(/^here(?:'s| is)\s+(?:a\s+)?(?:polished|refined|revised)\s+version\s+of\s+your\s+broadcast:?\s*/i, '')
    .replace(/^sure,?\s+i\s+can\s+help.*?\n+/i, '')
    .replace(/would you like me to .*$/ims, '')
    .replace(/^\s*-{3,}\s*/m, '')
    .trim();

  return text || value.trim();
};

export const createDraft = async ({
  schoolId = DEFAULT_SCHOOL_ID,
  createdBy,
  createdByName = '',
  createdByRole,
  audienceType,
  classId,
  recipientStudentId,
  recipientStudentName = '',
  targetClass = '',
  recipientPhone = '',
  title = '',
  originalText,
  draftedText = '',
  attachments = [],
  channels = ['telegram']
}: CreateDraftArgs) => {
  let finalDraft = draftedText || originalText;

  if (!draftedText) {
    try {
      finalDraft = await chatWithSchoolAgent(
        [{
          role: 'user',
          content: `Polish this school broadcast. Return only the final announcement text that parents should receive. Do not include assistant commentary, explanations, labels, questions, markdown fences, or phrases like "Here's a polished version" or "Would you like me to adjust".\n\n${originalText}`
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

  finalDraft = cleanBroadcastText(finalDraft);

  return Broadcast.create({
    schoolId,
    createdBy,
    createdByName,
    createdByRole,
    audienceType,
    classId,
    recipientStudentId,
    recipientStudentName,
    targetClass,
    recipientPhone,
    title,
    originalText: cleanBroadcastText(originalText),
    draftedText: finalDraft,
    attachments,
    approvalStatus: 'pending_approval',
    status: 'pending_approval',
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
  return uniqueByPhone(students.flatMap((student: any) =>
    [student.parentPhone, student.parentPhone2]
      .filter(Boolean)
      .map((phone) => ({
        name: student.parentName || 'Parent',
        phone,
        role: 'parent' as const,
        studentId: student._id,
        studentName: student.name || '',
        targetClass: student.class
      }))
  ));
};

const resolveClassName = async (classRef: string) => {
  if (!classRef) return '';
  if (!Types.ObjectId.isValid(classRef)) return classRef;
  const classRecord = await Class.findById(classRef).lean();
  return classRecord?.className || classRecord?.name || classRef;
};

const teacherRecipients = async () => {
  const teachers = await Teacher.find({ active: true }).lean();
  return uniqueByPhone(teachers.map((teacher: any) => ({
    name: teacher.fullName,
    phone: teacher.phone,
    role: 'teacher' as const
  })));
};

export const resolveRecipients = async (broadcast: {
  audienceType: BroadcastAudience;
  classId?: Types.ObjectId | string | null;
  targetClass?: string;
  recipientStudentId?: Types.ObjectId | string | null;
  recipientPhone?: string;
}): Promise<RecipientCandidate[]> => {
  if (broadcast.audienceType === 'class') {
    const targetClass = await resolveClassName(broadcast.targetClass || broadcast.classId?.toString() || '');
    if (!targetClass) return [];
    return parentRecipientsFromStudents({ class: targetClass });
  }

  if (broadcast.audienceType === 'parents') {
    return parentRecipientsFromStudents({});
  }

  if (broadcast.audienceType === 'whole_school') {
    return uniqueByPhone([
      ...await parentRecipientsFromStudents({}),
      ...await teacherRecipients()
    ]);
  }

  if (broadcast.audienceType === 'individual' || broadcast.audienceType === 'individual_parent') {
    if (broadcast.recipientStudentId) {
      const student = await Student.findOne({
        _id: broadcast.recipientStudentId,
        status: 'active'
      }).lean();

      if (!student) return [];

      return parentRecipientsFromStudents({ _id: student._id });
    }

    if (!broadcast.recipientPhone) return [];
    return [{ name: 'Parent', phone: broadcast.recipientPhone, role: 'parent' }];
  }

  if (broadcast.audienceType === 'teachers') {
    return teacherRecipients();
  }

  return [];
};

export const sendApprovedBroadcast = async (broadcastId: string, actor?: BroadcastActor) => {
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

  const body = cleanBroadcastText(broadcast.draftedText || broadcast.originalText);
  // TODO: Move broadcast attachments to durable cloud storage before production pilot.
  const attachments = (broadcast.attachments || []) as BroadcastAttachment[];
  const recipients = await resolveRecipients(broadcast);
  let sentCount = 0;
  let failedCount = 0;
  let pendingCount = 0;

  for (const recipient of recipients) {
    const identity = recipient.role === 'parent'
      ? await findParentTelegramIdentityByPhone(recipient.phone)
      : await TelegramIdentity.findOne({
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

      for (const attachment of attachments) {
        await bot.sendDocument(
          identity.chatId,
          attachment.filePath,
          {},
          {
            filename: attachment.originalName || attachment.fileName,
            contentType: attachment.mimeType || undefined
          }
        );
      }

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
  if (actor && Types.ObjectId.isValid(actor.id)) {
    broadcast.sentBy = new Types.ObjectId(actor.id);
    broadcast.sentByName = actor.name;
    broadcast.sentByRole = actor.role;
  }
  const unsuccessfulCount = failedCount + pendingCount;
  broadcast.status =
    totalRecipients === 0 || sentCount === 0
      ? 'failed'
      : unsuccessfulCount > 0
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

export const previewRecipients = async (
  input: {
    audienceType: BroadcastAudience;
    targetClass?: string;
    classId?: string;
    recipientStudentId?: string;
    recipientPhone?: string;
  }
): Promise<RecipientPreview> => {
  const recipients = await resolveRecipients({
    audienceType: input.audienceType,
    targetClass: input.targetClass || input.classId || '',
    recipientStudentId: input.recipientStudentId,
    recipientPhone: input.recipientPhone
  });

  const previewItems: RecipientPreviewItem[] = [];

  for (const recipient of recipients) {
    const identity = recipient.role === 'parent'
      ? await findParentTelegramIdentityByPhone(recipient.phone)
      : await TelegramIdentity.findOne({
          phone: normalizePhoneNumber(recipient.phone),
          status: recipient.role
        });

    previewItems.push({
      name: recipient.name,
      role: recipient.role,
      phone: normalizePhoneNumber(recipient.phone),
      studentName: (recipient as any).studentName || '',
      className: recipient.targetClass || '',
      telegramLinked: Boolean(identity?.chatId),
      telegramChatId: identity?.chatId || null,
      canReceiveNow: Boolean(identity?.chatId),
      reasonIfNotReachable: identity?.chatId ? null : 'Not connected to the school Telegram bot'
    });
  }

  const telegramReachable = previewItems.filter((recipient) => recipient.telegramLinked).length;
  const telegramMissing = previewItems.length - telegramReachable;

  return {
    audienceType: input.audienceType,
    totalContacts: previewItems.length,
    telegramReachable,
    telegramMissing,
    whatsappReachable: 0,
    whatsappMissing: 0,
    reachableNow: telegramReachable,
    unreachableNow: telegramMissing,
    recipients: previewItems
  };
};
