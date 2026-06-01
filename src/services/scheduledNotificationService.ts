import TelegramBot from 'node-telegram-bot-api';
import { Types } from 'mongoose';
import Student from '../models/Students';
import ScheduledNotification from '../models/ScheduledNotification';
import { type TeacherContext } from './teacherAuthService';
import { detectMessageIntent } from './broadcastService';
import logger from '../utils/logger';

// ─── Time parsing ─────────────────────────────────────────────────────────────

/**
 * Parses a "HH:MM" string (24hr) and builds a full UTC Date for today.
 * If that time has already passed, rolls to tomorrow.
 * Returns null if the string is invalid or empty.
 */
export const parseScheduledTime = (
  scheduledTime: string
): { date: Date; isNextDay: boolean } | null => {
  if (!scheduledTime?.trim()) return null;

  const match = scheduledTime.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;

  const hour   = parseInt(match[1], 10);
  const minute = parseInt(match[2], 10);

  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;

  const now = new Date();
  const scheduled = new Date();
  scheduled.setUTCHours(hour, minute, 0, 0);

  let isNextDay = false;
  if (scheduled <= now) {
    scheduled.setUTCDate(scheduled.getUTCDate() + 1);
    isNextDay = true;
  }

  return { date: scheduled, isNextDay };
};

/** Formats a Date as "H:MM AM/PM" for display to the teacher. */
export const formatDisplayTime = (date: Date): string => {
  const h = date.getUTCHours();
  const m = date.getUTCMinutes().toString().padStart(2, '0');
  const period = h >= 12 ? 'PM' : 'AM';
  const displayHour = h % 12 === 0 ? 12 : h % 12;
  return `${displayHour}:${m} ${period}`;
};

// ─── Schedule confirmation messages ──────────────────────────────────────────

const confirmBroadcastSchedule = (
  className: string,
  message: string,
  scheduledFor: Date,
  isNextDay: boolean
): string => {
  const timeStr = formatDisplayTime(scheduledFor);
  const dayStr  = isNextDay ? 'tomorrow' : 'today';

  const warning = isNextDay
    ? `⚠️ That time has already passed today.\nI have scheduled this message for tomorrow instead.\n\n`
    : '';

  const preview = message.length > 80 ? `${message.slice(0, 80)}...` : message;

  return (
    `${warning}` +
    `✅ *Reminder scheduled.*\n\n` +
    `Class: *${className}*\n` +
    `Message: "${preview}"\n` +
    `Sends at: *${timeStr} ${dayStr}*\n\n` +
    `I will deliver this to all *${className}* parents automatically.`
  );
};

const confirmIndividualSchedule = (
  studentName: string,
  message: string,
  scheduledFor: Date,
  isNextDay: boolean
): string => {
  const timeStr = formatDisplayTime(scheduledFor);
  const dayStr  = isNextDay ? 'tomorrow' : 'today';

  const warning = isNextDay
    ? `⚠️ That time has already passed today.\nI have scheduled this message for tomorrow instead.\n\n`
    : '';

  const preview = message.length > 80 ? `${message.slice(0, 80)}...` : message;

  return (
    `${warning}` +
    `✅ *Message scheduled.*\n\n` +
    `Student: *${studentName}*\n` +
    `Message: "${preview}"\n` +
    `Sends at: *${timeStr} ${dayStr}*\n\n` +
    `I will deliver this to ${studentName.split(' ')[0]}'s parent automatically.`
  );
};

// ─── View scheduled ───────────────────────────────────────────────────────────

export const handleViewScheduled = async (
  bot: TelegramBot,
  chatId: string,
  ctx: TeacherContext
): Promise<void> => {
  const jobs = await ScheduledNotification.find({
    teacherId: ctx.teacher._id,
    status: 'pending'
  }).sort({ scheduledFor: 1 });

  if (jobs.length === 0) {
    await bot.sendMessage(chatId, `📅 You have no pending scheduled messages.`);
    return;
  }

  const lines = jobs.map((job, i) => {
    const timeStr = formatDisplayTime(job.scheduledFor);
    const target  = job.targetType === 'broadcast'
      ? `Broadcast to ${job.targetClass}`
      : `${job.studentName || 'Student'}'s parent`;
    const preview = job.message.length > 50
      ? `${job.message.slice(0, 50)}...`
      : job.message;

    return `${i + 1}. *${timeStr}* — ${target}\n   "${preview}"`;
  });

  await bot.sendMessage(
    chatId,
    `📅 *Your pending scheduled messages:*\n\n${lines.join('\n\n')}\n\nReply with *"cancel 1"* or *"cancel 2"* etc. to cancel.`,
    { parse_mode: 'Markdown' }
  );
};

// ─── Cancel scheduled ─────────────────────────────────────────────────────────

export const handleCancelScheduled = async (
  bot: TelegramBot,
  chatId: string,
  ctx: TeacherContext,
  ref: string
): Promise<void> => {
  // Fetch teacher's pending jobs sorted the same way as view
  const jobs = await ScheduledNotification.find({
    teacherId: ctx.teacher._id,
    status: 'pending'
  }).sort({ scheduledFor: 1 });

  if (jobs.length === 0) {
    await bot.sendMessage(chatId, `You have no pending scheduled messages to cancel.`);
    return;
  }

  // Resolve by list index ("1", "2", ...) or by time string ("18:00", "6pm" → normalise)
  let job = jobs.find((_, i) => String(i + 1) === ref.trim());

  // If ref looks like a time ("18:00" or "18"), try matching scheduledFor hour
  if (!job && ref) {
    const hourMatch = ref.match(/^(\d{1,2})(?::(\d{2}))?/);
    if (hourMatch) {
      const refHour = parseInt(hourMatch[1], 10);
      job = jobs.find(j => j.scheduledFor.getUTCHours() === refHour);
    }
  }

  // If still not found, cancel the most recent one if only one exists
  if (!job && jobs.length === 1) job = jobs[0];

  if (!job) {
    await bot.sendMessage(
      chatId,
      `I couldn't identify which scheduled message to cancel.\n` +
      `Please reply with *"cancel 1"*, *"cancel 2"*, etc.`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  // Already sent?
  if (job.status !== 'pending') {
    await bot.sendMessage(
      chatId,
      `⚠️ That message has already been sent and cannot be cancelled.`
    );
    return;
  }

  await ScheduledNotification.updateOne({ _id: job._id }, { status: 'cancelled' });

  const timeStr = formatDisplayTime(job.scheduledFor);
  const target  = job.targetType === 'broadcast'
    ? `${ctx.className} parents`
    : `${job.studentName || 'the student'}'s parent`;

  await bot.sendMessage(
    chatId,
    `✅ *Scheduled message cancelled.*\nThe ${timeStr} reminder to *${target}* has been removed.`,
    { parse_mode: 'Markdown' }
  );
};

// ─── Orchestrator ─────────────────────────────────────────────────────────────

/**
 * Handles scheduled intent from the bot message handler.
 * Returns true if it processed the message (caller returns early).
 * Returns false if the intent was not scheduled/view_scheduled/cancel_scheduled.
 */
export const handleScheduledIfIntended = async (
  bot: TelegramBot,
  chatId: string,
  messageText: string,
  ctx: TeacherContext
): Promise<boolean> => {
  const intent = await detectMessageIntent(messageText, ctx);

  // ── View / Cancel ─────────────────────────────────────────────────────────
  if (intent.intent === 'view_scheduled') {
    await handleViewScheduled(bot, chatId, ctx);
    return true;
  }

  if (intent.intent === 'cancel_scheduled') {
    await handleCancelScheduled(bot, chatId, ctx, intent.ref);
    return true;
  }

  if (intent.intent !== 'scheduled') return false;

  // ── Scheduled intent ──────────────────────────────────────────────────────
  const { targetType, studentName, message, scheduledTime } = intent;

  // No time provided — ask for one
  if (!scheduledTime) {
    await bot.sendMessage(
      chatId,
      `What time should I send this message?\n` +
      `Please reply with a time like *"6pm"* or *"17:30"*.`,
      { parse_mode: 'Markdown' }
    );
    return true;
  }

  // Parse time
  const parsed = parseScheduledTime(scheduledTime);
  if (!parsed) {
    await bot.sendMessage(
      chatId,
      `I couldn't understand that time. Please reply with a format like *"6pm"* or *"18:30"*.`,
      { parse_mode: 'Markdown' }
    );
    return true;
  }

  const { date: scheduledFor, isNextDay } = parsed;

  // ── Individual: validate student first ───────────────────────────────────
  if (targetType === 'individual') {
    if (!studentName) {
      await bot.sendMessage(chatId, `Please include the student's name in your message.`);
      return true;
    }

    const matches = await Student.find({
      status: 'active',
      class: ctx.className,
      name: { $regex: studentName.trim(), $options: 'i' }
    }).select('name');

    if (matches.length === 0) {
      await bot.sendMessage(
        chatId,
        `I couldn't find a student named *${studentName}* in *${ctx.className}*.\n` +
        `Please check the name and try again.`,
        { parse_mode: 'Markdown' }
      );
      return true;
    }

    if (matches.length > 1) {
      const nameList = matches.map(s => `• ${s.name}`).join('\n');
      await bot.sendMessage(
        chatId,
        `I found more than one student matching *"${studentName}"*:\n\n${nameList}\n\n` +
        `Please provide the full name and resend your instruction.`,
        { parse_mode: 'Markdown' }
      );
      return true;
    }

    const student = matches[0];

    await ScheduledNotification.create({
      teacherId:    ctx.teacher._id,
      teacherChatId: chatId,
      targetType:   'individual',
      targetClass:  ctx.className,
      studentId:    student._id as Types.ObjectId,
      studentName:  student.name,
      message,
      scheduledFor,
      status: 'pending'
    });

    await bot.sendMessage(
      chatId,
      confirmIndividualSchedule(student.name, message, scheduledFor, isNextDay),
      { parse_mode: 'Markdown' }
    );

    logger.info(
      { teacher: ctx.teacher.fullName, student: student.name, scheduledFor },
      'Individual message scheduled'
    );

    return true;
  }

  // ── Broadcast ─────────────────────────────────────────────────────────────
  await ScheduledNotification.create({
    teacherId:    ctx.teacher._id,
    teacherChatId: chatId,
    targetType:   'broadcast',
    targetClass:  ctx.className,
    message,
    scheduledFor,
    status: 'pending'
  });

  await bot.sendMessage(
    chatId,
    confirmBroadcastSchedule(ctx.className, message, scheduledFor, isNextDay),
    { parse_mode: 'Markdown' }
  );

  logger.info(
    { teacher: ctx.teacher.fullName, className: ctx.className, scheduledFor },
    'Broadcast scheduled'
  );

  return true;
};
