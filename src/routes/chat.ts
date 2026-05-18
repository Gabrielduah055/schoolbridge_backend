import { Router } from 'express';
import type { Request, Response } from 'express';
import { chatWithSchoolAgent } from '../agents/schoolAgent';
import Conversation from '../models/Conversation';

const router = Router();
const conversations = new Map<string, any[]>();

router.post('/message', async (req: Request, res: Response) => {
  try {
    const { 
      sessionId, 
      message, 
      userRole = 'parent',
      userPhone = 'dashboard-test',
      userName = 'Test User'
    } = req.body;

    if (!conversations.has(sessionId)) {
      conversations.set(sessionId, []);
    }

    const history = conversations.get(sessionId)!;
    history.push({ role: 'user', content: message });

    const aiResponse = await chatWithSchoolAgent(
      history,
      userRole,
      userPhone,
      userName
    );

    history.push({ role: 'assistant', content: aiResponse });

    // Save conversation to MongoDB
    await Conversation.findOneAndUpdate(
      { parentPhone: `dashboard_${sessionId}` },
      {
        $push: {
          messages: [
            { 
              role: 'user', 
              content: message, 
              senderName: userName,
              timestamp: new Date() 
            },
            { 
              role: 'assistant', 
              content: aiResponse, 
              senderName: 'SchoolBridge Bot',
              timestamp: new Date() 
            }
          ]
        },
        parentPhone: `dashboard_${sessionId}`,
        type: 'parent_bot'
      },
      { upsert: true, new: true }
    );

    res.json({
      response: aiResponse,
      sessionId
    });

  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ error: 'Something went wrong' });
  }
});

// Reset conversation
router.post('/reset', (req: Request, res: Response) => {
  const { sessionId } = req.body;
  conversations.delete(sessionId);
  res.json({ message: 'Conversation reset' });
});

export default router;
