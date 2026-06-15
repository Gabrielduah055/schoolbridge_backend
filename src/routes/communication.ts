import { Router } from 'express';
import type { Request, Response } from 'express';
import ChannelAccount from '../models/ChannelAccount';
import Conversation from '../models/Conversation';
import Message from '../models/Message';
import HandoverTicket from '../models/HandoverTicket';
import Broadcast from '../models/Broadcast';
import MessageRecipient from '../models/MessageRecipient';
import DeliveryLog from '../models/DeliveryLog';
import WebhookEvent from '../models/WebhookEvent';
import { createDraft, sendApprovedBroadcast } from '../services/communication/broadcastService';
import { DEFAULT_SCHOOL_ID } from '../config/school';

const router = Router();

const schoolFilter = (req: Request) => ({
  schoolId: req.query.schoolId?.toString() || DEFAULT_SCHOOL_ID
});

router.get('/channel-accounts', async (req: Request, res: Response) => {
  try {
    const accounts = await ChannelAccount.find(schoolFilter(req)).sort({ channel: 1 });
    res.json(accounts);
  } catch {
    res.status(500).json({ error: 'Failed to fetch channel accounts' });
  }
});

router.get('/conversations', async (req: Request, res: Response) => {
  try {
    const filter: Record<string, unknown> = schoolFilter(req);
    if (req.query.status) filter.status = req.query.status;
    if (req.query.channel) filter.channel = req.query.channel;

    const conversations = await Conversation.find(filter)
      .sort({ lastMessageAt: -1, updatedAt: -1 })
      .limit(100);

    res.json(conversations);
  } catch {
    res.status(500).json({ error: 'Failed to fetch conversations' });
  }
});

router.get('/conversations/:id', async (req: Request, res: Response) => {
  try {
    const conversation = await Conversation.findById(req.params.id);
    if (!conversation) {
      res.status(404).json({ error: 'Conversation not found' });
      return;
    }
    res.json(conversation);
  } catch {
    res.status(500).json({ error: 'Failed to fetch conversation' });
  }
});

router.get('/conversations/:id/messages', async (req: Request, res: Response) => {
  try {
    const messages = await Message.find({ conversationId: req.params.id })
      .sort({ createdAt: 1 })
      .limit(300);
    res.json(messages);
  } catch {
    res.status(500).json({ error: 'Failed to fetch conversation messages' });
  }
});

router.get('/handover-tickets', async (req: Request, res: Response) => {
  try {
    const filter: Record<string, unknown> = schoolFilter(req);
    if (req.query.status) filter.status = req.query.status;

    const tickets = await HandoverTicket.find(filter)
      .sort({ createdAt: -1 })
      .limit(100);
    res.json(tickets);
  } catch {
    res.status(500).json({ error: 'Failed to fetch handover tickets' });
  }
});

router.post('/handover-tickets/:id/resolve', async (req: Request, res: Response) => {
  try {
    const ticket = await HandoverTicket.findByIdAndUpdate(
      req.params.id,
      {
        status: 'resolved',
        resolvedAt: new Date(),
        internalNotes: req.body.internalNotes ?? undefined
      },
      { new: true }
    );

    if (!ticket) {
      res.status(404).json({ error: 'Handover ticket not found' });
      return;
    }

    await Conversation.updateOne({ _id: ticket.conversationId }, { status: 'resolved' });
    res.json(ticket);
  } catch {
    res.status(500).json({ error: 'Failed to resolve handover ticket' });
  }
});

router.get('/broadcasts', async (req: Request, res: Response) => {
  try {
    const broadcasts = await Broadcast.find(schoolFilter(req))
      .sort({ createdAt: -1 })
      .limit(100);
    res.json(broadcasts);
  } catch {
    res.status(500).json({ error: 'Failed to fetch broadcasts' });
  }
});

router.post('/broadcasts/draft', async (req: Request, res: Response) => {
  try {
    const { createdByRole, audienceType, originalText } = req.body;
    if (!createdByRole || !audienceType || !originalText) {
      res.status(400).json({ error: 'createdByRole, audienceType, and originalText are required' });
      return;
    }

    const broadcast = await createDraft({
      schoolId: req.body.schoolId || DEFAULT_SCHOOL_ID,
      createdByRole,
      audienceType,
      title: req.body.title,
      originalText,
      draftedText: req.body.draftedText,
      channels: req.body.channels || ['telegram']
    });

    res.status(201).json(broadcast);
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to create broadcast draft' });
  }
});

router.post('/broadcasts/:id/approve', async (req: Request, res: Response) => {
  try {
    const broadcast = await Broadcast.findByIdAndUpdate(
      req.params.id,
      { approvalStatus: 'approved' },
      { new: true }
    );
    if (!broadcast) {
      res.status(404).json({ error: 'Broadcast not found' });
      return;
    }
    res.json(broadcast);
  } catch {
    res.status(500).json({ error: 'Failed to approve broadcast' });
  }
});

router.post('/broadcasts/:id/send', async (req: Request, res: Response) => {
  try {
    const broadcast = await sendApprovedBroadcast(req.params.id.toString());
    res.json(broadcast);
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Failed to send broadcast' });
  }
});

router.get('/broadcasts/:id/recipients', async (req: Request, res: Response) => {
  try {
    const recipients = await MessageRecipient.find({ broadcastId: req.params.id })
      .sort({ createdAt: 1 });
    res.json(recipients);
  } catch {
    res.status(500).json({ error: 'Failed to fetch broadcast recipients' });
  }
});

router.get('/delivery-logs', async (req: Request, res: Response) => {
  try {
    const logs = await DeliveryLog.find(schoolFilter(req))
      .sort({ createdAt: -1 })
      .limit(200);
    res.json(logs);
  } catch {
    res.status(500).json({ error: 'Failed to fetch delivery logs' });
  }
});

router.get('/webhook-events', async (req: Request, res: Response) => {
  try {
    const events = await WebhookEvent.find(schoolFilter(req))
      .sort({ createdAt: -1 })
      .limit(200);
    res.json(events);
  } catch {
    res.status(500).json({ error: 'Failed to fetch webhook events' });
  }
});

export default router;
