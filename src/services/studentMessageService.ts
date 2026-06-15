import TelegramBot from 'node-telegram-bot-api';
import { Types } from 'mongoose';
import Student from '../models/Students';
import TelegramIdentity from '../models/TelegramIdentity';
import Message from '../models/Message';
import { getPhoneLookupCandidates } from '../utils/phone';
import { type TeacherContext } from './teacherAuthService';
import { detectMessageIntent } from './broadcastService';
import { DEFAULT_SCHOOL_ID } from '../config/school';
import { logDelivery } from './communication/deliveryService';
import logger from '../utils/logger';

// ─── Student name resolution ──────────────────────────────────────────────────

interface StudentMatch {
  _id: Types.ObjectId;
  name: string;
  class: string;
  parentPhone: string;
  parentPhone2: string;
}

/**
 * Finds students in the teacher's class whose name matches the search term.
 * Case-insensitive, partial-name friendly.
 * Returns all matches — the caller handles the ambiguity case.
 */
const findStudentsByName = async (
  nameQuery: string,
  className: string
): Promise<StudentMatch[]> => {
  return Student.find({
    status: 'active',
    class: className,
    name: { $regex: nameQuery.trim(), $options: 'i' }
  }).select('name class parentPhone parentPhone2') as unknown as StudentMatch[];
};

// ─── Parent resolver ──────────────────────────────────────────────────────────

/**
 * Given a student, finds the verified parent's Telegram chatId.
 * Tries parentPhone first, then parentPhone2.
 * Returns the chatId string, or null if not found.
 */
const resolveParentChatId = async (
  student: StudentMatch
): Promise<string | null> => {
  const phonesToTry = [student.parentPhone, student.parentPhone2].filter(Boolean);

  for (const phone of phonesToTry) {
    const candidates = getPhoneLookupCandidates(phone);
    const identity = await TelegramIdentity.findOne({
      phone: { $in: candidates },
      status: 'parent'
    }).select('chatId');

    if (identity?.chatId) return identity.chatId;
  }

  return null;
};

// ─── Message logger ───────────────────────────────────────────────────────────

const logIndividualMessage = async (
  ctx: TeacherContext,
  studentId: Types.ObjectId,
  extractedMessage: string,
  status: 'sent' | 'failed'
): Promise<void> => {
  const message = await Message.create({
    schoolId: DEFAULT_SCHOOL_ID,
    channel: 'telegram',
    direction: 'outgoing',
    senderRole: 'teacher',
    senderName: ctx.teacher.fullName,
    body: extractedMessage,
    messageType: 'text',
    aiGenerated: false,
    senderType: 'teacher',
    senderId: ctx.teacher._id,
    recipientType: 'individual',
    targetClass: ctx.className,
    studentId,
    message: extractedMessage,
    deliveredTo: status === 'sent' ? [studentId] : [],
    failedTo: status === 'failed' ? [studentId] : [],
    status,
    sentAt: new Date()
  });

  await logDelivery({
    messageId: message._id as Types.ObjectId,
    channel: 'telegram',
    provider: 'telegram',
    eventType: 'individual_message_summary',
    status,
    rawPayload: {
      studentId: studentId.toString(),
      className: ctx.className
    }
  });
};

// ─── Orchestrator ─────────────────────────────────────────────────────────────

/**
 * Full student-specific messaging pipeline.
 * Returns true if it handled the message (caller should return early).
 * Returns false if the intent was not student_message.
 */
export const handleStudentMessageIfIntended = async (
  bot: TelegramBot,
  chatId: string,
  messageText: string,
  ctx: TeacherContext
): Promise<boolean> => {
  // ── 1. Classify intent — re-use the cached call from broadcastService ────
  //    broadcastService.handleBroadcastIfIntended already called detectMessageIntent
  //    but returned false for student_message, so we call it again here.
  //    This is a cheap second AI call only when broadcast returned false.
  const intent = await detectMessageIntent(messageText, ctx);
  if (intent.intent !== 'student_message') return false;

  const { studentName, message: extractedMessage } = intent;

  // ── 2. Guard: extracted message must not be empty ─────────────────────────
  if (!extractedMessage.trim()) {
    await bot.sendMessage(
      chatId,
      `Please include the message content you want to send to ${studentName}'s parent.`
    );
    return true;
  }

  // ── 3. Find matching students in teacher's class ──────────────────────────
  const matches = await findStudentsByName(studentName, ctx.className);

  if (matches.length === 0) {
    await bot.sendMessage(
      chatId,
      `I couldn't find a student named *${studentName}* in *${ctx.className}*.\n` +
      `Please check the name and try again.`,
      { parse_mode: 'Markdown' }
    );
    return true;
  }

  // ── 4. Ambiguity guard: multiple matches → ask for full name ──────────────
  if (matches.length > 1) {
    const nameList = matches.map(s => `• ${s.name}`).join('\n');
    await bot.sendMessage(
      chatId,
      `I found more than one student matching *"${studentName}"* in *${ctx.className}*:\n\n` +
      `${nameList}\n\n` +
      `Please provide the full name to continue.`,
      { parse_mode: 'Markdown' }
    );
    return true;
  }

  // ── 5. Exactly one match — verify it belongs to teacher's class ───────────
  const student = matches[0];

  // ── 6. Find the parent's Telegram chatId ─────────────────────────────────
  const parentChatId = await resolveParentChatId(student);

  if (!parentChatId) {
    await bot.sendMessage(
      chatId,
      `⚠️ *${student.name}'s* parent has not yet verified on Telegram.\n` +
      `Your message could not be delivered.\n` +
      `Please notify the school admin to follow up.`,
      { parse_mode: 'Markdown' }
    );
    await logIndividualMessage(ctx, student._id, extractedMessage, 'failed');
    return true;
  }

  // ── 7. Format and send message to parent ─────────────────────────────────
  const formatted =
    `💬 *Message from ${student.name.split(' ')[0]}'s Class Teacher*\n\n` +
    `${extractedMessage}\n\n` +
    `— _SchoolBridge_`;

  try {
    await bot.sendMessage(parentChatId, formatted, { parse_mode: 'Markdown' });

    // ── 8. Log to Messages collection ───────────────────────────────────────
    await logIndividualMessage(ctx, student._id, extractedMessage, 'sent');

    // ── 9. Confirm delivery to teacher ───────────────────────────────────────
    const preview =
      extractedMessage.length > 80
        ? `${extractedMessage.slice(0, 80)}...`
        : extractedMessage;

    await bot.sendMessage(
      chatId,
      `✅ *Message delivered to ${student.name}'s parent.*\n\n` +
      `Student: *${student.name}*\n` +
      `Class: *${ctx.className}*\n` +
      `Message: "${preview}"`,
      { parse_mode: 'Markdown' }
    );

    logger.info(
      { teacher: ctx.teacher.fullName, student: student.name, className: ctx.className },
      'Individual message delivered'
    );

  } catch (err) {
    // Bot blocked or invalid chatId — notify teacher gracefully
    await logIndividualMessage(ctx, student._id, extractedMessage, 'failed');

    await bot.sendMessage(
      chatId,
      `⚠️ Message could not be delivered to *${student.name}'s* parent.\n` +
      `They may have blocked the bot.\n` +
      `Please contact the school admin.`,
      { parse_mode: 'Markdown' }
    );

    logger.error(
      { teacher: ctx.teacher.fullName, student: student.name, err },
      'Individual message send failed'
    );
  }

  return true;
};

// ─── Reusable job executor (called by scheduler worker) ──────────────────────

/**
 * Executes a student-specific message for a scheduled job.
 * Reuses all existing lookup and log helpers — no duplicated logic.
 */
export const executeIndividualMessageJob = async (
  bot: TelegramBot,
  teacherId: Types.ObjectId,
  teacherChatId: string,
  className: string,
  studentId: Types.ObjectId,
  studentName: string,
  message: string
): Promise<void> => {
  // Look up student directly by ID — already validated at schedule time
  const student = await (await import('../models/Students')).default.findById(studentId)
    .select('name parentPhone parentPhone2') as unknown as StudentMatch | null;

  if (!student) {
    logger.warn({ studentId }, 'Scheduled individual job: student not found');
    return;
  }

  const parentChatId = await resolveParentChatId(student);
  const formatted =
    `💬 *Message from ${student.name.split(' ')[0]}'s Class Teacher*\n\n` +
    `${message}\n\n` +
    `— _SchoolBridge_`;

  let status: 'sent' | 'failed' = 'failed';

  if (parentChatId) {
    try {
      await bot.sendMessage(parentChatId, formatted, { parse_mode: 'Markdown' });
      status = 'sent';
    } catch (err) {
      logger.error({ studentId, err }, 'Scheduled individual job: send failed');
    }
  }

  await Message.create({
    schoolId: DEFAULT_SCHOOL_ID,
    channel: 'telegram',
    direction: 'outgoing',
    senderRole: 'teacher',
    senderName: 'Teacher',
    body: message,
    messageType: 'text',
    aiGenerated: false,
    senderType: 'teacher',
    senderId: teacherId,
    recipientType: 'individual',
    targetClass: className,
    studentId,
    message,
    deliveredTo: status === 'sent' ? [studentId] : [],
    failedTo: status === 'failed' ? [studentId] : [],
    status,
    sentAt: new Date()
  });

  // Notify teacher of result
  const resultText = status === 'sent'
    ? `✅ *Scheduled message sent to ${student.name}'s parent.*`
    : `⚠️ *Scheduled message to ${student.name}'s parent failed* (not on Telegram or blocked).`;

  try {
    await bot.sendMessage(teacherChatId, resultText, { parse_mode: 'Markdown' });
  } catch {
    logger.warn({ teacherChatId }, 'Could not notify teacher of individual job result');
  }
};
