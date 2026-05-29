import type TelegramBot from 'node-telegram-bot-api';
import EscalationTicket from '../models/EscalationTicket';
import { setSessionStatus } from './sessionService';
import logger from '../utils/logger';

const TICKET_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// ─── Ticket ID generation ─────────────────────────────────────────────────────

/**
 * Generates a human-readable ticket ID in the format ESC-YYYYMMDD-XXXX.
 * The counter is scoped to the current day so IDs reset daily.
 * Uses countDocuments to derive the next number — safe for low-volume use.
 */
const generateTicketId = async (): Promise<string> => {
  const today     = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const dayStart  = new Date();
  dayStart.setHours(0, 0, 0, 0);

  const count = await EscalationTicket.countDocuments({
    createdAt: { $gte: dayStart }
  });

  return `ESC-${today}-${String(count + 1).padStart(4, '0')}`;
};

// ─── Raise escalation ─────────────────────────────────────────────────────────

export interface EscalationResult {
  success:  boolean;
  ticketId?: string;
  message:  string;
}

/**
 * Creates an escalation ticket for a visitor whose phone is not in Students.
 * Guards against:
 *   - Duplicate pending ticket for the same chatId
 *   - Duplicate pending ticket for the same phone (different chatId → flagged)
 * Sends a notification to the admin Telegram group if ADMIN_TELEGRAM_GROUP_ID is set.
 */
export const raiseEscalation = async (
  bot: TelegramBot,
  chatId: string,
  telegramUserId: string,
  phone: string,
  firstName: string,
  username?: string
): Promise<EscalationResult> => {

  // Guard: existing pending ticket for this chatId
  const existingForChat = await EscalationTicket.findOne({
    chatId,
    status: 'pending'
  });

  if (existingForChat) {
    return {
      success: false,
      message: `You already have a pending verification request (Ticket: \`${existingForChat.ticketId}\`). Please wait for an admin to review it — you will be notified here once it is processed.`
    };
  }

  // Guard: same phone already has a pending ticket from a different account
  const existingForPhone = await EscalationTicket.findOne({
    claimedPhone: phone,
    status: 'pending'
  });

  const ticketId = await generateTicketId();
  const isDuplicate = Boolean(existingForPhone);

  await EscalationTicket.create({
    ticketId,
    chatId,
    telegramUserId,
    claimedPhone:         phone,
    status:               isDuplicate ? 'duplicate' : 'pending',
    duplicateOfTicketId:  existingForPhone?.ticketId ?? null,
    expiresAt:            new Date(Date.now() + TICKET_EXPIRY_MS)
  });

  if (isDuplicate) {
    return {
      success: false,
      ticketId,
      message: `There is already a pending verification request for this phone number from another account (Ticket: \`${existingForPhone!.ticketId}\`). Your request (\`${ticketId}\`) has been flagged as a duplicate.\n\nPlease contact the school office directly if you believe this is an error.`
    };
  }

  // Notify admin group
  await notifyAdminGroup(bot, ticketId, phone, firstName, username);

  return {
    success:  true,
    ticketId,
    message:  `✅ Your verification request has been submitted.\n\n*Ticket:* \`${ticketId}\`\n\nAn admin will review your request and you will be notified here. This usually takes 1–2 business days.\n\nIf you need urgent help, please contact the school office directly.`
  };
};

// ─── Admin group notification ─────────────────────────────────────────────────

const notifyAdminGroup = async (
  bot: TelegramBot,
  ticketId: string,
  phone: string,
  firstName: string,
  username?: string
): Promise<void> => {
  const adminGroupId = process.env.ADMIN_TELEGRAM_GROUP_ID;

  if (!adminGroupId) {
    logger.warn({ ticketId }, 'ADMIN_TELEGRAM_GROUP_ID not set — ticket created but admin not notified');
    return;
  }

  const userLine = username ? `Username: @${username}` : `Name: ${firstName}`;
  const message  = [
    `🔔 *PARENT VERIFICATION REQUEST*`,
    ``,
    `Ticket: \`${ticketId}\``,
    `${userLine}`,
    `Phone: \`${phone}\``,
    `Status: Pending`,
    ``,
    `To approve:`,
    `\`/approve ${ticketId}\``,
    ``,
    `To reject:`,
    `\`/reject ${ticketId} <reason>\``
  ].join('\n');

  try {
    const sent = await bot.sendMessage(adminGroupId, message, { parse_mode: 'Markdown' });
    await EscalationTicket.updateOne({ ticketId }, { adminGroupMessageId: sent.message_id });
  } catch (err) {
    logger.error({ ticketId, err }, 'Failed to notify admin group');
  }
};

// ─── Approve ──────────────────────────────────────────────────────────────────

/**
 * Approves a pending ticket. Upgrades the user's TelegramSession to 'parent'
 * and sends them a success notification.
 */
export const approveEscalation = async (
  bot: TelegramBot,
  ticketId: string,
  adminIdentifier: string
): Promise<EscalationResult> => {
  const ticket = await EscalationTicket.findOne({ ticketId });

  if (!ticket) {
    return { success: false, message: `Ticket \`${ticketId}\` not found.` };
  }

  if (ticket.status !== 'pending') {
    return { success: false, message: `Ticket \`${ticketId}\` is already *${ticket.status}*. No action taken.` };
  }

  await EscalationTicket.updateOne(
    { ticketId },
    { status: 'approved', resolvedBy: adminIdentifier, resolvedAt: new Date() }
  );

  // Upgrade session — admin-approved parent gets same 7-day TTL
  if (ticket.claimedPhone) {
    await setSessionStatus(ticket.chatId, 'parent', ticket.claimedPhone);
  }

  // Notify the user
  try {
    await bot.sendMessage(
      ticket.chatId,
      `✅ *Verification Approved*\n\nYour phone number has been verified by the school admin. You now have parent access.\n\nSend /start to see your child's information.`,
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    logger.error({ ticketId, err }, 'Failed to notify user of approval');
  }

  return { success: true, message: `Ticket \`${ticketId}\` approved. The parent has been notified and granted access.` };
};

// ─── Reject ───────────────────────────────────────────────────────────────────

/**
 * Rejects a pending ticket and notifies the user with the admin's reason.
 */
export const rejectEscalation = async (
  bot: TelegramBot,
  ticketId: string,
  adminIdentifier: string,
  reason: string
): Promise<EscalationResult> => {
  const ticket = await EscalationTicket.findOne({ ticketId });

  if (!ticket) {
    return { success: false, message: `Ticket \`${ticketId}\` not found.` };
  }

  if (ticket.status !== 'pending') {
    return { success: false, message: `Ticket \`${ticketId}\` is already *${ticket.status}*. No action taken.` };
  }

  const resolvedReason = reason.trim() || 'No reason provided.';

  await EscalationTicket.updateOne(
    { ticketId },
    {
      status:         'rejected',
      resolvedBy:     adminIdentifier,
      resolutionNote: resolvedReason,
      resolvedAt:     new Date()
    }
  );

  // Notify the user
  try {
    await bot.sendMessage(
      ticket.chatId,
      `❌ *Verification Request Not Approved*\n\nReason: ${resolvedReason}\n\nIf you believe this is an error, please contact the school office directly with your proof of guardianship.`,
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    logger.error({ ticketId, err }, 'Failed to notify user of rejection');
  }

  return { success: true, message: `Ticket \`${ticketId}\` rejected. The user has been notified.` };
};

// ─── Ticket status lookup ─────────────────────────────────────────────────────

/**
 * Returns a human-readable status summary for a chatId's most recent ticket.
 * Used by the /ticket command.
 */
export const getTicketStatusForChat = async (
  chatId: string
): Promise<string | null> => {
  const ticket = await EscalationTicket.findOne(
    { chatId },
    {},
    { sort: { createdAt: -1 } }
  );

  if (!ticket) return null;

  const statusEmoji: Record<string, string> = {
    pending:   '⏳',
    approved:  '✅',
    rejected:  '❌',
    duplicate: '⚠️'
  };

  const lines = [
    `${statusEmoji[ticket.status] ?? '❓'} *Ticket:* \`${ticket.ticketId}\``,
    `*Status:* ${ticket.status.charAt(0).toUpperCase() + ticket.status.slice(1)}`,
    `*Phone:* ${ticket.claimedPhone ?? 'Not recorded'}`,
    `*Created:* ${ticket.createdAt.toDateString()}`
  ];

  if (ticket.status === 'rejected' && ticket.resolutionNote) {
    lines.push(`*Reason:* ${ticket.resolutionNote}`);
  }

  if (ticket.status === 'duplicate' && ticket.duplicateOfTicketId) {
    lines.push(`*Duplicate of:* \`${ticket.duplicateOfTicketId}\``);
  }

  return lines.join('\n');
};
