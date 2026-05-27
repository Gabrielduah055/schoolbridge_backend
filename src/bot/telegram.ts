import TelegramBot from 'node-telegram-bot-api';
import { chatWithSchoolAgent } from '../agents/schoolAgent';

const token = process.env.TELEGRAM_BOT_TOKEN as string;

if (!token) {
  throw new Error('TELEGRAM_BOT_TOKEN is not defined');
}

const bot = new TelegramBot(token, { polling: true });

// Correct type — array of message objects
const conversations = new Map<string, { role: 'user' | 'assistant'; content: string }[]>();

const sanitizeTelegramError = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(token, '[TELEGRAM_BOT_TOKEN]');
};

const safeSendMessage = async (
  chatId: string,
  text: string,
  options?: TelegramBot.SendMessageOptions
): Promise<void> => {
  try {
    await bot.sendMessage(chatId, text, options);
  } catch (error) {
    console.error('Telegram send failed:', sanitizeTelegramError(error));
  }
};

console.log('🤖 SchoolBridge Telegram bot started...');

// Handle /start command
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id.toString();
  const firstName = msg.from?.first_name || 'there';

  await safeSendMessage(chatId,
    `Hello ${firstName}! 👋\n\nWelcome to *${process.env.SCHOOL_NAME}* Bot.\n\nI can help you with general school information such as:\n• 📅 School calendar and holidays\n• 🏫 School policies and rules\n• 📋 Admission information\n• 📞 School contact details\n• 💰 General fee information\n\nFor personalized information about your child, please contact the school office to register your number.\n\nHow can I help you today?`,
    { parse_mode: 'Markdown' }
  );
});

// Handle all messages
bot.on('message', async (msg) => {
  const chatId = msg.chat.id.toString();
  const messageText = msg.text || '';

  if (!messageText || messageText.startsWith('/')) return;

  try {
    try {
      await bot.sendChatAction(chatId, 'typing');
    } catch (error) {
      console.error('Telegram typing indicator failed:', sanitizeTelegramError(error));
    }

    if (!conversations.has(chatId)) {
      conversations.set(chatId, []);
    }

    const history = conversations.get(chatId)!;
    history.push({ role: 'user' as const, content: messageText });

    const aiResponse = await chatWithSchoolAgent(
      history,
      'unregistered',
      `telegram_${chatId}`,
      msg.from?.first_name || 'Visitor'
    );

    history.push({ role: 'assistant' as const, content: aiResponse });

    await safeSendMessage(chatId, aiResponse, {
      parse_mode: 'Markdown'
    });

  } catch (error) {
    console.error('Bot error:', error);
    await safeSendMessage(chatId,
      'Sorry, something went wrong. Please try again. 🙏'
    );
  }
});

bot.on('polling_error', (error) => {
  console.error('Polling error:', sanitizeTelegramError(error));
});

export default bot;
