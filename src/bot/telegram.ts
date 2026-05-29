import TelegramBot from 'node-telegram-bot-api';
import type { Application } from 'express';
import { chatWithSchoolAgent } from '../agents/schoolAgent';
import AuditLog from '../models/AuditLog';
import {
  getOrCreateSession,
  getSession,
  setSessionStatus,
  resetSession,
  addToConversationHistory,
  loadHistory,
  isTelegramAccountChange
} from '../services/sessionService';
import {
  findParentByPhone,
  findParentStudents,
  findStudentMentionedInMessage,
  phoneOwnsStudent
} from '../services/verificationService';
import {
  raiseEscalation,
  approveEscalation,
  rejectEscalation,
  getTicketStatusForChat
} from '../services/escalationService';
import { normalizePhoneNumber } from '../utils/phone';
import { checkRateLimit, secondsUntilReset } from '../utils/rateLimiter';
import logger from '../utils/logger';

const token = process.env.TELEGRAM_BOT_TOKEN as string;

if (!token) {
  throw new Error('TELEGRAM_BOT_TOKEN is not defined');
}

// Create bot WITHOUT polling — initBot() decides how to start it
const bot = new TelegramBot(token);

type Message = { role: 'user' | 'assistant'; content: string };

// ─── Error helpers ────────────────────────────────────────────────────────────

const sanitizeTelegramError = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(token, '[TELEGRAM_BOT_TOKEN]');
};

// ─── Messaging helpers ────────────────────────────────────────────────────────

const safeSendMessage = async (
  chatId: string,
  text: string,
  options?: TelegramBot.SendMessageOptions
): Promise<void> => {
  try {
    await bot.sendMessage(chatId, text, options);
  } catch (error) {
    logger.error({ err: sanitizeTelegramError(error) }, 'Telegram send failed');
  }
};

const buildContactKeyboard = (): TelegramBot.ReplyKeyboardMarkup => ({
  keyboard: [[{ text: 'Share phone number', request_contact: true }]],
  resize_keyboard: true,
  one_time_keyboard: true
});

const sendInitialVerificationRequest = async (chatId: string, firstName: string) => {
  await safeSendMessage(
    chatId,
    `Hello ${firstName}! Before we chat, please share your phone number so I can check whether you are a registered parent or an unregistered visitor.`,
    { reply_markup: buildContactKeyboard() }
  );
};


// ─── Audit log (local wrapper so failures never crash the bot) ─────────────────

const writeAuditLog = async (
  event: 'verification_success' | 'verification_failed' | 'access_denied',
  chatId: string,
  extras: { phone?: string; severity?: 'info' | 'warn' | 'security' } = {}
): Promise<void> => {
  try {
    await AuditLog.create({
      event,
      chatId,
      phone:    extras.phone    ?? null,
      severity: extras.severity ?? 'info'
    });
  } catch (err) {
    logger.error({ err }, 'AuditLog write failed');
  }
};


// ─── Greeting / mismatch helpers ─────────────────────────────────────────────

const detectAndHandleAccountChange = async (
  chatId: string,
  session: { telegramUserId: string },
  incomingUserId: string,
  firstName: string
): Promise<boolean> => {
  if (!isTelegramAccountChange(session as any, incomingUserId)) {
    return false;
  }

  logger.warn({ chatId }, 'Account change detected — resetting session');
  await resetSession(chatId);
  await sendInitialVerificationRequest(chatId, firstName);
  return true;
};

const sendPhoneVerificationRequest = async (chatId: string) => {
  await safeSendMessage(
    chatId,
    'Please share your phone number first so I can check whether you are the registered parent or guardian for that student.',
    { reply_markup: buildContactKeyboard() }
  );
};

// Generic message — no student name passed to prevent enrollment enumeration
const sendGuardianMismatchMessage = async (chatId: string) => {
  await safeSendMessage(
    chatId,
    `I'm sorry, I cannot share that student's information. The phone number you shared is not listed as an authorised parent or guardian contact.\n\nIf this is your child, please contact the school office to register or update your guardian details.`,
    { reply_markup: { remove_keyboard: true } }
  );
};

const guardStudentAccessRequest = async (
  chatId: string,
  messageText: string,
  phoneNumber?: string
): Promise<boolean> => {
  const mentionedStudent = await findStudentMentionedInMessage(messageText);

  if (!mentionedStudent) return false;

  if (!phoneNumber) {
    await sendPhoneVerificationRequest(chatId);
    return true;
  }

  if (!phoneOwnsStudent(mentionedStudent, phoneNumber)) {
    await sendGuardianMismatchMessage(chatId);
    await writeAuditLog('access_denied', chatId, { phone: phoneNumber, severity: 'security' });
    return true;
  }

  return false;
};

const sendParentGreeting = async (
  chatId: string,
  user: { name: string; phone: string; role: string }
) => {
  const students  = await findParentStudents(user.phone);
  const childText = students.length > 0
    ? `\nYour child${students.length > 1 ? 'ren' : ''}: ${students.map(s => `*${s.name}* (${s.class})`).join(', ')}`
    : '';

  await safeSendMessage(
    chatId,
    `Hello ${user.name}!\n\nYou are registered as a *Parent* at *${process.env.SCHOOL_NAME}*.\n${childText}\n\nYou can ask me about:\n- Your child's fee balance\n- School calendar and holidays\n- Class timetable and schedule\n- School announcements\n- School policies and rules\n\nHow can I help you today?`,
    { parse_mode: 'Markdown', reply_markup: { remove_keyboard: true } }
  );
};

const sendVisitorGreeting = async (
  chatId: string,
  firstName: string,
  includeContactPrompt = true
) => {
  await safeSendMessage(
    chatId,
    `Hello ${firstName}!\n\nWelcome to *${process.env.SCHOOL_NAME}* Bot.\n\nI can help you with general school information such as:\n- School calendar and holidays\n- School policies and rules\n- Admission information\n- School contact details\n- General fee information\n\nFor personalized information about your child, please contact the school office to register your number.\n\nHow can I help you today?`,
    {
      parse_mode: 'Markdown',
      reply_markup: includeContactPrompt ? buildContactKeyboard() : { remove_keyboard: true }
    }
  );
};

// ─── Contact handler ──────────────────────────────────────────────────────────

const handleContactMessage = async (msg: TelegramBot.Message) => {
  const chatId    = msg.chat.id.toString();
  const firstName = msg.from?.first_name || 'there';
  const contact   = msg.contact;

  if (!contact?.phone_number) return;

  // Reject forwarded contacts — must be the user's own number
  if (!contact.user_id || !msg.from?.id || contact.user_id !== msg.from.id) {
    await safeSendMessage(
      chatId,
      'Please use the "Share phone number" button to share your own Telegram phone number. I cannot verify forwarded or saved contacts.',
      { reply_markup: buildContactKeyboard() }
    );
    return;
  }

  const normalizedPhone = normalizePhoneNumber(contact.phone_number);

  // Source of truth: Students collection only — no User upsert
  const parent = await findParentByPhone(contact.phone_number);

  if (parent) {
    await setSessionStatus(chatId, 'parent', normalizedPhone);
    await writeAuditLog('verification_success', chatId, { phone: normalizedPhone });
    await sendParentGreeting(chatId, parent);
    return;
  }

  await setSessionStatus(chatId, 'visitor', normalizedPhone);
  await writeAuditLog('verification_failed', chatId, { phone: normalizedPhone, severity: 'warn' });

  await safeSendMessage(
    chatId,
    `Hello ${firstName}! I checked the number you shared, but I could not find it as a registered parent or guardian contact.\n\nYou can still ask me general school questions.\n\n💡 *If you are a parent and believe your number should be registered,* use /escalate to request manual verification from the school admin.`,
    { parse_mode: 'Markdown', reply_markup: { remove_keyboard: true } }
  );
};

// ─── /escalate command ────────────────────────────────────────────────────────
// Lets unregistered visitors request manual verification from the school admin.

bot.onText(/\/escalate/, async (msg) => {
  if (msg.chat.type !== 'private') return;

  const chatId = msg.chat.id.toString();

  try {
    const session = await getSession(chatId);

    if (!session || session.status === 'unverified') {
      await safeSendMessage(
        chatId,
        'Please share your phone number first using the button below, then use /escalate.',
        { reply_markup: buildContactKeyboard() }
      );
      return;
    }

    if (session.status === 'parent') {
      await safeSendMessage(chatId, '✅ You are already verified as a parent. Send /start to see your child\'s information.');
      return;
    }

    if (session.status === 'escalation_pending') {
      const statusText = await getTicketStatusForChat(chatId);
      await safeSendMessage(
        chatId,
        `You already have a pending verification request.\n\n${statusText ?? ''}`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    // status === 'visitor' — phone shared but not in Students
    const { message } = await raiseEscalation(
      bot,
      chatId,
      session.telegramUserId,
      session.phone!,
      session.firstName || msg.from?.first_name || 'Unknown',
      session.username || msg.from?.username
    );

    await safeSendMessage(chatId, message, { parse_mode: 'Markdown' });

  } catch (err) {
    logger.error({ chatId, err }, '/escalate error');
    await safeSendMessage(chatId, 'Sorry, something went wrong. Please try again.');
  }
});

// ─── /ticket command ──────────────────────────────────────────────────────────
// Lets a user check the status of their most recent verification request.

bot.onText(/\/ticket/, async (msg) => {
  if (msg.chat.type !== 'private') return;

  const chatId = msg.chat.id.toString();

  try {
    const statusText = await getTicketStatusForChat(chatId);

    if (!statusText) {
      await safeSendMessage(
        chatId,
        'You have no verification requests on file. Use /escalate to submit one.'
      );
      return;
    }

    await safeSendMessage(chatId, statusText, { parse_mode: 'Markdown' });

  } catch (err) {
    logger.error({ chatId, err }, '/ticket error');
    await safeSendMessage(chatId, 'Sorry, something went wrong. Please try again.');
  }
});

// ─── Admin commands ───────────────────────────────────────────────────────────
// /approve and /reject ONLY work in the admin Telegram group.
// They are silently ignored in private chats and other groups.

bot.onText(/\/approve\s+(\S+)/, async (msg, match) => {
  const adminGroupId = process.env.ADMIN_TELEGRAM_GROUP_ID;
  if (!adminGroupId || msg.chat.id.toString() !== adminGroupId) return;

  const ticketId      = match?.[1]?.trim() ?? '';
  const adminIdentity = msg.from?.username
    ? `@${msg.from.username}`
    : msg.from?.id?.toString() ?? 'unknown';

  try {
    const { message } = await approveEscalation(bot, ticketId, adminIdentity);
    await safeSendMessage(adminGroupId, message, { parse_mode: 'Markdown' });
  } catch (err) {
    logger.error({ err }, '/approve error');
    await safeSendMessage(adminGroupId, '❌ Failed to process approval. Check server logs.');
  }
});

bot.onText(/\/reject\s+(\S+)(?:\s+(.+))?/, async (msg, match) => {
  const adminGroupId = process.env.ADMIN_TELEGRAM_GROUP_ID;
  if (!adminGroupId || msg.chat.id.toString() !== adminGroupId) return;

  const ticketId      = match?.[1]?.trim() ?? '';
  const reason        = match?.[2]?.trim() ?? 'No reason provided.';
  const adminIdentity = msg.from?.username
    ? `@${msg.from.username}`
    : msg.from?.id?.toString() ?? 'unknown';

  try {
    const { message } = await rejectEscalation(bot, ticketId, adminIdentity, reason);
    await safeSendMessage(adminGroupId, message, { parse_mode: 'Markdown' });
  } catch (err) {
    logger.error({ err }, '/reject error');
    await safeSendMessage(adminGroupId, '❌ Failed to process rejection. Check server logs.');
  }
});

// ─── /start command ───────────────────────────────────────────────────────────

bot.onText(/\/start/, async (msg) => {

  const chatId    = msg.chat.id.toString();
  const firstName = msg.from?.first_name || 'there';

  try {
    const session       = await getOrCreateSession(msg);
    const incomingUserId = msg.from?.id?.toString() ?? '';

    // Account change detection — different Telegram user on same chatId
    const changed = await detectAndHandleAccountChange(chatId, session, incomingUserId, firstName);
    if (changed) return;

    if (session.status === 'parent' && session.phone) {
      const parent = await findParentByPhone(session.phone);
      if (parent) {
        await sendParentGreeting(chatId, parent);
        return;
      }
      // Phone was removed from Students — reset session and re-verify
      await resetSession(chatId);
      await sendInitialVerificationRequest(chatId, firstName);
      return;
    }

    if (session.status === 'visitor') {
      await sendVisitorGreeting(chatId, session.firstName || firstName, false);
      return;
    }

    // 'unverified' or 'escalation_pending' → prompt for phone
    await sendInitialVerificationRequest(chatId, firstName);

  } catch (error) {
    logger.error({ chatId, err: error }, '/start error');
    await safeSendMessage(chatId,
      `Hello ${firstName}! Welcome to *${process.env.SCHOOL_NAME}* Bot. How can I help you?`,
      { parse_mode: 'Markdown' }
    );
  }
});

// ─── Main message handler ─────────────────────────────────────────────────────

bot.on('message', async (msg) => {
  const chatId      = msg.chat.id.toString();
  const messageText = msg.text || '';

  if (msg.contact) {
    await handleContactMessage(msg);
    return;
  }

  if (!messageText || messageText.startsWith('/')) return;

  // Bot only handles private chats
  if (msg.chat.type !== 'private') return;

  // ── Rate limiting ── max 10 messages / 60 seconds per chatId ──────────────
  if (!checkRateLimit(chatId)) {
    const waitSecs = secondsUntilReset(chatId);
    await safeSendMessage(
      chatId,
      `⏳ You're sending messages too quickly. Please wait ${waitSecs} second${waitSecs !== 1 ? 's' : ''} and try again.`
    );
    return;
  }


  try {
    try {
      await bot.sendChatAction(chatId, 'typing');
    } catch (error) {
      logger.warn({ chatId, err: sanitizeTelegramError(error) }, 'Telegram typing indicator failed');
    }

    const session = await getSession(chatId);

    // No session at all → prompt for phone
    if (!session) {
      await sendInitialVerificationRequest(chatId, msg.from?.first_name || 'there');
      return;
    }

    // Account change detection
    const incomingUserId = msg.from?.id?.toString() ?? '';
    const changed = await detectAndHandleAccountChange(
      chatId, session, incomingUserId, msg.from?.first_name || 'there'
    );
    if (changed) return;

    // Unverified — no phone shared yet
    if (session.status === 'unverified') {
      await sendInitialVerificationRequest(chatId, session.firstName || msg.from?.first_name || 'there');
      return;
    }

    const isParent  = session.status === 'parent';
    const userRole  = isParent ? 'parent' : 'unregistered';
    const userName  = session.firstName || msg.from?.first_name || 'Visitor';
    const userPhone = session.phone ?? '';

    const handledByAccessGuard = await guardStudentAccessRequest(
      chatId,
      messageText,
      isParent ? userPhone : undefined   // visitors don't get student guard — just AI
    );
    if (handledByAccessGuard) return;

    // Load history from DB via service
    const history = loadHistory(session);
    history.push({ role: 'user', content: messageText });

    const aiResponse = await chatWithSchoolAgent(history, userRole, userPhone, userName);

    // Persist the exchange — atomic $push + $slice in MongoDB
    await addToConversationHistory(chatId, messageText, aiResponse);

    await safeSendMessage(chatId, aiResponse, { parse_mode: 'Markdown' });

    logger.info({ userRole, userName }, 'Message handled');

  } catch (error) {
    logger.error({ chatId, err: error }, 'Bot message handler error');
    await safeSendMessage(chatId, 'Sorry, something went wrong. Please try again.');
  }
});

bot.on('polling_error', (error) => {
  logger.error({ err: sanitizeTelegramError(error) }, 'Polling error');
});

// ─── Bot lifecycle ────────────────────────────────────────────────────────────

/**
 * Call this once after the DB is connected.
 * - production  → registers a webhook with Telegram and mounts the POST route
 * - development → deletes any stale webhook and falls back to polling
 */
export const initBot = async (app: Application): Promise<void> => {
  const isProduction = process.env.NODE_ENV === 'production';

  if (isProduction) {
    const webhookUrl    = process.env.TELEGRAM_WEBHOOK_URL;
    const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;

    if (!webhookUrl)    throw new Error('TELEGRAM_WEBHOOK_URL is not set');
    if (!webhookSecret) throw new Error('TELEGRAM_WEBHOOK_SECRET is not set');

    await bot.setWebHook(`${webhookUrl}/api/bot/webhook`, {
      secret_token: webhookSecret
    });

    app.post('/api/bot/webhook', (req, res) => {
      const incoming = req.headers['x-telegram-bot-api-secret-token'];
      if (incoming !== webhookSecret) {
        logger.warn('Webhook: rejected request with invalid secret');
        res.sendStatus(403);
        return;
      }

      // Respond 200 immediately — Telegram retries if we take > 5s
      res.sendStatus(200);
      bot.processUpdate(req.body);
    });

    logger.info({ webhookUrl }, 'SchoolBridge bot ready via webhook');

  } else {
    // Local dev — clear any webhook Render left behind, then start polling
    await bot.deleteWebHook();
    bot.startPolling();
    logger.info('SchoolBridge bot ready via polling (development)');
  }
};

export default bot;
