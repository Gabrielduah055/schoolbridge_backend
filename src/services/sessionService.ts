import TelegramBot from 'node-telegram-bot-api';
import TelegramSession, { type ITelegramSession } from '../models/TelegramSession';

// ─── TTL constants ─────────────────────────────────────────────────────────────
export const SESSION_TTL_PARENT_MS     = 7 * 24 * 60 * 60 * 1000;  // 7 days
export const SESSION_TTL_VISITOR_MS    = 24 * 60 * 60 * 1000;       // 24 hours
export const SESSION_TTL_UNVERIFIED_MS = 60 * 60 * 1000;            // 1 hour

// Maximum message entries kept in conversationHistory (user+assistant pairs)
export const MAX_HISTORY_MESSAGES = 20;

// ─── Session read ──────────────────────────────────────────────────────────────

export const getSession = async (chatId: string): Promise<ITelegramSession | null> => {
  return TelegramSession.findOne({ chatId });
};

/**
 * Returns the existing session for this chatId, or creates a new 'unverified'
 * one. Uses $setOnInsert so two simultaneous messages don't race to create
 * duplicate sessions.
 */
export const getOrCreateSession = async (
  msg: TelegramBot.Message
): Promise<ITelegramSession> => {
  const chatId         = msg.chat.id.toString();
  const telegramUserId = msg.from?.id?.toString() ?? '';

  const session = await TelegramSession.findOneAndUpdate(
    { chatId },
    {
      $setOnInsert: {
        chatId,
        telegramUserId,
        phone:               null,
        status:              'unverified',
        firstName:           msg.from?.first_name ?? '',
        lastName:            msg.from?.last_name  ?? '',
        username:            msg.from?.username   ?? '',
        isOwnContact:        false,
        conversationHistory: [],
        expiresAt:           new Date(Date.now() + SESSION_TTL_UNVERIFIED_MS),
        lastActivityAt:      new Date()
      }
    },
    { upsert: true, new: true }
  );

  return session!;
};

// ─── Session writes ────────────────────────────────────────────────────────────

/**
 * Transition the session to a new status after phone verification.
 * Always clears conversationHistory — prevents stale AI context from leaking
 * across verification boundaries (e.g. a visitor who becomes a parent).
 */
export const setSessionStatus = async (
  chatId: string,
  status: ITelegramSession['status'],
  phone: string
): Promise<void> => {
  const ttl = status === 'parent' ? SESSION_TTL_PARENT_MS : SESSION_TTL_VISITOR_MS;

  await TelegramSession.updateOne(
    { chatId },
    {
      $set: {
        status,
        phone,
        isOwnContact:        true,
        expiresAt:           new Date(Date.now() + ttl),
        lastActivityAt:      new Date(),
        conversationHistory: []   // ← intentional: clean slate after verification
      }
    }
  );
};

/**
 * Permanently remove a session. Called when a Telegram account change is
 * detected so the new user must re-verify from scratch.
 */
export const resetSession = async (chatId: string): Promise<void> => {
  await TelegramSession.deleteOne({ chatId });
};

// ─── Conversation history ──────────────────────────────────────────────────────

/**
 * Appends a user+assistant exchange to the session's conversationHistory.
 * The MongoDB $slice operator caps the array atomically — no separate trim step
 * needed, and it's race-condition safe.
 */
export const addToConversationHistory = async (
  chatId: string,
  userMessage: string,
  aiResponse: string
): Promise<void> => {
  await TelegramSession.updateOne(
    { chatId },
    {
      $push: {
        conversationHistory: {
          $each: [
            { role: 'user',      content: userMessage, timestamp: new Date() },
            { role: 'assistant', content: aiResponse,  timestamp: new Date() }
          ],
          $slice: -MAX_HISTORY_MESSAGES
        }
      },
      $set: { lastActivityAt: new Date() }
    }
  );
};

/**
 * Load conversation history from a session, formatted for the AI.
 * Returns an empty array if the session is null.
 */
export const loadHistory = (
  session: ITelegramSession | null
): Array<{ role: 'user' | 'assistant'; content: string }> => {
  if (!session) return [];
  return session.conversationHistory
    .slice(-MAX_HISTORY_MESSAGES)
    .map(h => ({ role: h.role as 'user' | 'assistant', content: h.content }));
};

// ─── Account change detection ─────────────────────────────────────────────────

/**
 * Returns true if the incoming Telegram user ID is different from the one stored
 * in the session. This catches device handovers and account changes.
 * Callers should reset the session and return early when this is true.
 */
export const isTelegramAccountChange = (
  session: ITelegramSession,
  incomingUserId: string
): boolean => {
  return Boolean(session.telegramUserId) &&
         session.telegramUserId !== incomingUserId;
};
