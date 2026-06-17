import { Router } from 'express';
import type { Request, Response } from 'express';
import { Types } from 'mongoose';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import bot from '../bot/telegram';
import ChannelAccount from '../models/ChannelAccount';
import Conversation from '../models/Conversation';
import Message from '../models/Message';
import HandoverTicket from '../models/HandoverTicket';
import Broadcast from '../models/Broadcast';
import MessageRecipient from '../models/MessageRecipient';
import DeliveryLog from '../models/DeliveryLog';
import WebhookEvent from '../models/WebhookEvent';
import Student from '../models/Students';
import Teacher from '../models/Teacher';
import ClassModel from '../models/Class';
import TelegramIdentity from '../models/TelegramIdentity';
import { cleanBroadcastText, createDraft, sendApprovedBroadcast } from '../services/communication/broadcastService';
import { recordOutgoingMessage } from '../services/communication/messageService';
import { logDelivery } from '../services/communication/deliveryService';
import { createTicket } from '../services/communication/handoverService';
import { requirePermission } from '../middleware/authorization';
import { PERMISSIONS } from '../config/permissions';
import { DEFAULT_SCHOOL_ID } from '../config/school';
import { normalizePhoneNumber } from '../utils/phone';

const router = Router();
const broadcastUploadDir = path.join('uploads', 'broadcasts');

if (!fs.existsSync(broadcastUploadDir)) {
  fs.mkdirSync(broadcastUploadDir, { recursive: true });
}

const broadcastUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, broadcastUploadDir),
    filename: (_req, file, cb) => {
      const safeBase = path.basename(file.originalname).replace(/[^a-zA-Z0-9._-]/g, '_');
      cb(null, `${Date.now()}-${safeBase}`);
    }
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowedMimeTypes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'text/plain',
      'text/csv',
      'image/jpeg',
      'image/png'
    ];

    if (allowedMimeTypes.includes(file.mimetype)) {
      cb(null, true);
      return;
    }

    cb(new Error('Broadcast attachments must be PDF, Office, text/CSV, JPG, or PNG files.'));
  }
});

const schoolFilter = (req: Request) => ({
  schoolId: req.authUser?.schoolId || req.query.schoolId?.toString() || DEFAULT_SCHOOL_ID
});

const startOfToday = () => {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
};

const toObjectIdOrNull = (value: unknown) => {
  const text = value?.toString();
  return text && Types.ObjectId.isValid(text) ? new Types.ObjectId(text) : null;
};

const unique = <T>(values: T[]) => Array.from(new Set(values.filter(Boolean)));
const SENT_BROADCAST_STATUSES = ['sent', 'partial', 'partially_failed'] as const;

const parseTelegramChannels = (value: unknown): Array<'telegram'> => {
  const channels = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : ['telegram'];

  const telegramChannels = channels
    .map((channel) => channel?.toString().trim())
    .filter((channel): channel is 'telegram' => channel === 'telegram');

  return telegramChannels.length > 0 ? telegramChannels : ['telegram'];
};

const getLastConversationAt = async (phone: string) => {
  if (!phone) return null;
  const normalized = normalizePhoneNumber(phone);
  const conversation = await Conversation.findOne({
    $or: [
      { participantPhone: normalized },
      { parentPhone: normalized }
    ]
  }).sort({ lastMessageAt: -1, updatedAt: -1 });
  return conversation?.lastMessageAt || conversation?.updatedAt || null;
};

const getIdentityStatus = async (phone: string, role?: 'parent' | 'teacher') => {
  if (!phone) return 'not_connected';
  const identity = await TelegramIdentity.findOne({
    phone: normalizePhoneNumber(phone),
    ...(role ? { status: role } : {})
  });
  return identity ? 'connected' : 'not_connected';
};

router.get('/channel-accounts', requirePermission(PERMISSIONS.CHANNELS_VIEW), async (req: Request, res: Response) => {
  try {
    const accounts = await ChannelAccount.find(schoolFilter(req)).sort({ channel: 1 });
    res.json(accounts);
  } catch {
    res.status(500).json({ error: 'Failed to fetch channel accounts' });
  }
});

router.get('/dashboard/metrics', requirePermission(PERMISSIONS.DASHBOARD_VIEW), async (req: Request, res: Response) => {
  try {
    const schoolId = schoolFilter(req).schoolId;
    const today = startOfToday();

    const [
      messagesToday,
      openConversations,
      pendingHandovers,
      failedDeliveries,
      broadcastsSentToday,
      telegramAccount,
      recentConversations,
      recentHandovers
    ] = await Promise.all([
      Message.countDocuments({ schoolId, createdAt: { $gte: today } }),
      Conversation.countDocuments({ schoolId, status: { $nin: ['resolved', 'failed', 'failed_delivery'] } }),
      HandoverTicket.countDocuments({ schoolId, status: { $in: ['open', 'assigned'] } }),
      DeliveryLog.countDocuments({ schoolId, status: 'failed' }),
      Broadcast.countDocuments({
        schoolId,
        status: { $in: SENT_BROADCAST_STATUSES },
        sentAt: { $gte: today }
      }),
      ChannelAccount.findOne({ schoolId, channel: 'telegram' }).sort({ updatedAt: -1 }),
      Conversation.find({ schoolId }).sort({ lastMessageAt: -1, updatedAt: -1 }).limit(6),
      HandoverTicket.find({ schoolId }).sort({ createdAt: -1 }).limit(6)
    ]);

    res.json({
      messagesToday,
      openConversations,
      pendingHandovers,
      failedDeliveries,
      broadcastsSentToday,
      telegramStatus: telegramAccount?.status || 'unknown',
      whatsappStatus: 'not_configured',
      recentConversations,
      recentHandovers
    });
  } catch {
    res.status(500).json({ error: 'Failed to fetch dashboard metrics' });
  }
});

router.get('/parents', requirePermission(PERMISSIONS.PARENTS_VIEW), async (req: Request, res: Response) => {
  try {
    const students = await Student.find({ status: 'active' }).sort({ parentName: 1, class: 1, name: 1 }).lean();
    const parents = new Map<string, any>();

    for (const student of students as any[]) {
      if (!student.parentPhone) continue;
      const phone = normalizePhoneNumber(student.parentPhone);
      const current = parents.get(phone) ?? {
        name: student.parentName || 'Parent',
        phone,
        email: student.parentEmail || '',
        linkedStudents: [],
        classes: [],
        preferredChannel: 'telegram',
        channelIdentityStatus: await getIdentityStatus(phone, 'parent'),
        lastConversationAt: await getLastConversationAt(phone)
      };

      current.linkedStudents.push({
        id: student._id,
        name: student.name,
        class: student.class,
        admissionNumber: student.admissionNumber
      });
      current.classes = unique([...current.classes, student.class]);
      parents.set(phone, current);
    }

    res.json(Array.from(parents.values()));
  } catch {
    res.status(500).json({ error: 'Failed to fetch parents' });
  }
});

router.get('/teachers', requirePermission(PERMISSIONS.TEACHERS_VIEW), async (_req: Request, res: Response) => {
  try {
    const teachers = await Teacher.find({ active: true }).sort({ fullName: 1 }).lean();
    const result = await Promise.all((teachers as any[]).map(async (teacher) => {
      const classes = await ClassModel.find({ teacherId: teacher._id, active: true }).lean();
      return {
        id: teacher._id,
        name: teacher.fullName,
        phone: teacher.phone,
        email: teacher.email || '',
        assignedClasses: classes.map((item: any) => item.className),
        subject: '',
        channelIdentityStatus: await getIdentityStatus(teacher.phone, 'teacher'),
        lastConversationAt: await getLastConversationAt(teacher.phone)
      };
    }));
    res.json(result);
  } catch {
    res.status(500).json({ error: 'Failed to fetch teachers' });
  }
});

router.get('/classes', requirePermission(PERMISSIONS.CLASSES_VIEW), async (req: Request, res: Response) => {
  try {
    const students = await Student.find({ status: 'active' }).lean();
    const classes = await ClassModel.find({ active: true }).populate('teacherId').lean();
    const byClass = new Map<string, any>();

    for (const student of students as any[]) {
      const className = student.class || 'Unassigned';
      const current = byClass.get(className) ?? {
        id: className,
        className,
        teacher: 'Not assigned',
        studentCount: 0,
        parentContactCount: 0,
        recentBroadcastCount: 0,
        parentPhones: new Set<string>()
      };
      current.studentCount++;
      if (student.parentPhone) current.parentPhones.add(normalizePhoneNumber(student.parentPhone));
      byClass.set(className, current);
    }

    for (const classRecord of classes as any[]) {
      const current = byClass.get(classRecord.className) ?? {
        id: classRecord._id,
        className: classRecord.className,
        teacher: 'Not assigned',
        studentCount: 0,
        parentContactCount: 0,
        recentBroadcastCount: 0,
        parentPhones: new Set<string>()
      };
      current.id = classRecord._id;
      current.teacher = classRecord.teacherId?.fullName || 'Not assigned';
      byClass.set(classRecord.className, current);
    }

    const response = await Promise.all(Array.from(byClass.values()).map(async (item) => ({
      id: item.id,
      className: item.className,
      teacher: item.teacher,
      studentCount: item.studentCount,
      parentContactCount: item.parentPhones.size,
      recentBroadcastCount: await Broadcast.countDocuments({
        schoolId: schoolFilter(req).schoolId,
        targetClass: item.className,
        status: { $in: SENT_BROADCAST_STATUSES }
      })
    })));

    res.json(response.sort((a, b) => a.className.localeCompare(b.className)));
  } catch {
    res.status(500).json({ error: 'Failed to fetch classes' });
  }
});

router.get('/classes/:id/parents', requirePermission(PERMISSIONS.CLASSES_VIEW), async (req: Request, res: Response) => {
  try {
    const classId = req.params.id.toString();
    const classRecord = Types.ObjectId.isValid(classId)
      ? await ClassModel.findById(classId)
      : null;
    const className = classRecord?.className || decodeURIComponent(classId);
    const students = await Student.find({ status: 'active', class: className }).sort({ name: 1 }).lean();

    const parents = await Promise.all((students as any[])
      .filter((student) => student.parentPhone)
      .map(async (student) => ({
        class: className,
        student: {
          id: student._id,
          name: student.name,
          admissionNumber: student.admissionNumber
        },
        parentName: student.parentName || 'Parent',
        parentPhone: normalizePhoneNumber(student.parentPhone),
        parentEmail: student.parentEmail || '',
        channelIdentityStatus: await getIdentityStatus(student.parentPhone, 'parent')
      })));

    res.json({ className, parents });
  } catch {
    res.status(500).json({ error: 'Failed to fetch class parents' });
  }
});

router.get('/teachers/:id/classes', requirePermission(PERMISSIONS.TEACHERS_VIEW), async (req: Request, res: Response) => {
  try {
    const teacherId = req.params.id.toString();
    const teacher = Types.ObjectId.isValid(teacherId)
      ? await Teacher.findById(teacherId)
      : await Teacher.findOne({ phone: normalizePhoneNumber(teacherId) });

    if (!teacher) {
      res.status(404).json({ error: 'Teacher not found' });
      return;
    }

    const classes = await ClassModel.find({ teacherId: teacher._id, active: true }).lean();
    const response = await Promise.all((classes as any[]).map(async (classItem) => {
      const students = await Student.find({ status: 'active', class: classItem.className }).lean();
      const parentPhones = unique((students as any[]).map((student) => normalizePhoneNumber(student.parentPhone || '')));
      return {
        className: classItem.className,
        studentCount: students.length,
        parentContactCount: parentPhones.length
      };
    }));

    res.json({
      teacher: {
        id: teacher._id,
        name: teacher.fullName,
        phone: teacher.phone
      },
      classes: response
    });
  } catch {
    res.status(500).json({ error: 'Failed to fetch teacher classes' });
  }
});

router.get('/conversations', requirePermission(PERMISSIONS.CONVERSATIONS_VIEW), async (req: Request, res: Response) => {
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

router.post('/conversations/:id/reply', requirePermission(PERMISSIONS.CONVERSATIONS_REPLY), async (req: Request, res: Response) => {
  try {
    const body = req.body.body?.toString().trim();
    const senderName = req.body.senderName?.toString().trim() || req.authUser?.name || 'Admin';
    const senderRole = req.body.senderRole === 'admin' ? 'admin' : 'admin';

    if (!body) {
      res.status(400).json({ error: 'Reply body is required' });
      return;
    }

    const conversation = await Conversation.findById(req.params.id);
    if (!conversation) {
      res.status(404).json({ error: 'Conversation not found' });
      return;
    }

    if (conversation.channel !== 'telegram') {
      res.status(400).json({ error: 'Manual replies for this channel are not implemented yet.' });
      return;
    }

    const message = await recordOutgoingMessage({
      schoolId: conversation.schoolId,
      channel: 'telegram',
      conversationId: conversation._id as Types.ObjectId,
      senderName,
      senderRole,
      body,
      aiGenerated: false,
      status: 'queued'
    });

    try {
      const sent = await bot.sendMessage(conversation.externalChatId, body);
      await Message.updateOne(
        { _id: message._id },
        {
          $set: {
            status: 'sent',
            providerMessageId: sent.message_id.toString(),
            sentAt: new Date()
          }
        }
      );

      await Conversation.updateOne(
        { _id: conversation._id },
        {
          $set: {
            lastMessageAt: new Date(),
            status: conversation.status === 'resolved' ? 'resolved' : 'assigned'
          }
        }
      );

      await logDelivery({
        messageId: message._id as Types.ObjectId,
        schoolId: conversation.schoolId,
        channel: 'telegram',
        provider: 'telegram_bot',
        providerMessageId: sent.message_id.toString(),
        eventType: 'dashboard_manual_reply_sent',
        status: 'sent',
        rawPayload: sent as unknown as Record<string, unknown>
      });

      const updatedMessage = await Message.findById(message._id);
      res.status(201).json(updatedMessage);
    } catch (error: any) {
      await Message.updateOne(
        { _id: message._id },
        { $set: { status: 'failed' } }
      );
      await Conversation.updateOne(
        { _id: conversation._id },
        { $set: { status: 'failed_delivery', lastMessageAt: new Date() } }
      );
      await logDelivery({
        messageId: message._id as Types.ObjectId,
        schoolId: conversation.schoolId,
        channel: 'telegram',
        provider: 'telegram_bot',
        eventType: 'dashboard_manual_reply_failed',
        status: 'failed',
        errorMessage: error?.message || 'Telegram send failed'
      });
      res.status(502).json({ error: 'Failed to send Telegram reply' });
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to send conversation reply' });
  }
});

router.post('/conversations/:id/assign', requirePermission(PERMISSIONS.CONVERSATIONS_ASSIGN), async (req: Request, res: Response) => {
  try {
    const assignedTo = req.body.assignedTo?.toString().trim();
    if (!assignedTo) {
      res.status(400).json({ error: 'assignedTo is required' });
      return;
    }

    const conversation = await Conversation.findById(req.params.id);
    if (!conversation) {
      res.status(404).json({ error: 'Conversation not found' });
      return;
    }

    conversation.assignedTo = assignedTo;
    if (conversation.status !== 'resolved') conversation.status = 'assigned';
    await conversation.save();
    res.json(conversation);
  } catch {
    res.status(500).json({ error: 'Failed to assign conversation' });
  }
});

router.post('/conversations/:id/resolve', requirePermission(PERMISSIONS.CONVERSATIONS_RESOLVE), async (req: Request, res: Response) => {
  try {
    const conversation = await Conversation.findByIdAndUpdate(
      req.params.id,
      { status: 'resolved', resolvedAt: new Date() },
      { new: true }
    );

    if (!conversation) {
      res.status(404).json({ error: 'Conversation not found' });
      return;
    }

    await HandoverTicket.updateMany(
      { conversationId: conversation._id, status: { $in: ['open', 'assigned'] } },
      { $set: { status: 'resolved', resolvedAt: new Date() } }
    );
    res.json(conversation);
  } catch {
    res.status(500).json({ error: 'Failed to resolve conversation' });
  }
});

router.post('/conversations/:id/reopen', requirePermission(PERMISSIONS.CONVERSATIONS_RESOLVE), async (req: Request, res: Response) => {
  try {
    const conversation = await Conversation.findByIdAndUpdate(
      req.params.id,
      { status: 'open', resolvedAt: null },
      { new: true }
    );
    if (!conversation) {
      res.status(404).json({ error: 'Conversation not found' });
      return;
    }
    res.json(conversation);
  } catch {
    res.status(500).json({ error: 'Failed to reopen conversation' });
  }
});

router.post('/conversations/:id/mark-needs-human', requirePermission(PERMISSIONS.CONVERSATIONS_ASSIGN), async (req: Request, res: Response) => {
  try {
    const conversation = await Conversation.findById(req.params.id);
    if (!conversation) {
      res.status(404).json({ error: 'Conversation not found' });
      return;
    }

    const ticket = await createTicket({
      schoolId: conversation.schoolId,
      conversationId: conversation._id as Types.ObjectId,
      reason: req.body.reason?.toString().trim() || 'Marked for human attention by dashboard',
      priority: req.body.priority || 'normal',
      internalNotes: req.body.internalNotes || ''
    });

    const updated = await Conversation.findById(conversation._id);
    res.json({ conversation: updated, ticket });
  } catch {
    res.status(500).json({ error: 'Failed to mark conversation as needs human' });
  }
});

router.get('/conversations/:id', requirePermission(PERMISSIONS.CONVERSATIONS_VIEW), async (req: Request, res: Response) => {
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

router.get('/conversations/:id/messages', requirePermission(PERMISSIONS.CONVERSATIONS_VIEW), async (req: Request, res: Response) => {
  try {
    const messages = await Message.find({ conversationId: req.params.id })
      .sort({ createdAt: 1 })
      .limit(300);
    res.json(messages);
  } catch {
    res.status(500).json({ error: 'Failed to fetch conversation messages' });
  }
});

router.get('/handover-tickets', requirePermission(PERMISSIONS.HANDOVERS_VIEW), async (req: Request, res: Response) => {
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

router.post('/handover-tickets/:id/assign', requirePermission(PERMISSIONS.HANDOVERS_ASSIGN), async (req: Request, res: Response) => {
  try {
    const assignedTo = req.body.assignedTo?.toString().trim();
    if (!assignedTo) {
      res.status(400).json({ error: 'assignedTo is required' });
      return;
    }

    const ticket = await HandoverTicket.findById(req.params.id);
    if (!ticket) {
      res.status(404).json({ error: 'Handover ticket not found' });
      return;
    }

    ticket.assignedTo = assignedTo;
    if (req.authUser?.id && Types.ObjectId.isValid(req.authUser.id)) {
      ticket.assignedBy = new Types.ObjectId(req.authUser.id);
    }
    ticket.assignedByName = req.authUser?.name || 'Admin';
    if (ticket.status !== 'resolved') ticket.status = 'assigned';
    await ticket.save();

    await Conversation.updateOne(
      { _id: ticket.conversationId, status: { $ne: 'resolved' } },
      { $set: { assignedTo, status: 'assigned' } }
    );

    res.json(ticket);
  } catch {
    res.status(500).json({ error: 'Failed to assign handover ticket' });
  }
});

router.post('/handover-tickets/:id/note', requirePermission(PERMISSIONS.HANDOVERS_ASSIGN), async (req: Request, res: Response) => {
  try {
    const note = req.body.note?.toString().trim();
    const createdBy = req.body.createdBy?.toString().trim() || req.authUser?.name || 'Admin';
    if (!note) {
      res.status(400).json({ error: 'note is required' });
      return;
    }

    const ticket = await HandoverTicket.findByIdAndUpdate(
      req.params.id,
      {
        $push: { notes: { text: note, createdBy, createdAt: new Date() } },
        $set: { internalNotes: note }
      },
      { new: true }
    );

    if (!ticket) {
      res.status(404).json({ error: 'Handover ticket not found' });
      return;
    }

    res.json(ticket);
  } catch {
    res.status(500).json({ error: 'Failed to add handover note' });
  }
});

router.post('/handover-tickets/:id/resolve', requirePermission(PERMISSIONS.HANDOVERS_RESOLVE), async (req: Request, res: Response) => {
  try {
    const ticket = await HandoverTicket.findByIdAndUpdate(
      req.params.id,
      {
        status: 'resolved',
        resolvedAt: new Date(),
        ...(req.authUser?.id && Types.ObjectId.isValid(req.authUser.id) ? { resolvedBy: new Types.ObjectId(req.authUser.id) } : {}),
        resolvedByName: req.authUser?.name || 'Admin',
        internalNotes: req.body.internalNotes ?? undefined
      },
      { new: true }
    );

    if (!ticket) {
      res.status(404).json({ error: 'Handover ticket not found' });
      return;
    }

    if (req.body.resolveConversation !== false) {
      await Conversation.updateOne(
        { _id: ticket.conversationId },
        { status: 'resolved', resolvedAt: new Date() }
      );
    }
    res.json(ticket);
  } catch {
    res.status(500).json({ error: 'Failed to resolve handover ticket' });
  }
});

router.get('/broadcasts', requirePermission(PERMISSIONS.BROADCASTS_VIEW), async (req: Request, res: Response) => {
  try {
    const broadcasts = await Broadcast.find(schoolFilter(req))
      .sort({ createdAt: -1 })
      .limit(100);
    res.json(broadcasts);
  } catch {
    res.status(500).json({ error: 'Failed to fetch broadcasts' });
  }
});

router.get('/broadcasts/metrics', requirePermission(PERMISSIONS.BROADCASTS_VIEW), async (req: Request, res: Response) => {
  try {
    const schoolId = schoolFilter(req).schoolId;
    const today = startOfToday();

    const [
      totalBroadcasts,
      sentTotal,
      sentToday,
      draftCount,
      pendingApprovalCount,
      approvedCount,
      failedCount,
      sentRecipients,
      failedRecipients,
      skippedRecipients
    ] = await Promise.all([
      Broadcast.countDocuments({ schoolId }),
      Broadcast.countDocuments({
        schoolId,
        status: { $in: SENT_BROADCAST_STATUSES }
      }),
      Broadcast.countDocuments({
        schoolId,
        status: { $in: SENT_BROADCAST_STATUSES },
        sentAt: { $gte: today }
      }),
      Broadcast.countDocuments({ schoolId, status: 'draft' }),
      Broadcast.countDocuments({ schoolId, approvalStatus: 'pending_approval' }),
      Broadcast.countDocuments({ schoolId, approvalStatus: 'approved', status: { $in: ['draft', 'scheduled'] } }),
      Broadcast.countDocuments({ schoolId, status: 'failed' }),
      MessageRecipient.countDocuments({ status: 'sent' }),
      MessageRecipient.countDocuments({ status: 'failed' }),
      MessageRecipient.countDocuments({ status: 'skipped' })
    ]);

    res.json({
      totalBroadcasts,
      sentTotal,
      sentToday,
      draftCount,
      pendingApprovalCount,
      approvedCount,
      failedCount,
      recipientSummary: {
        sent: sentRecipients,
        failed: failedRecipients,
        skipped: skippedRecipients
      }
    });
  } catch {
    res.status(500).json({ error: 'Failed to fetch broadcast metrics' });
  }
});

router.post('/broadcasts/draft', requirePermission(PERMISSIONS.BROADCASTS_CREATE), broadcastUpload.single('attachment'), async (req: Request, res: Response) => {
  try {
    const { createdByRole, audienceType, originalText } = req.body;
    if (!createdByRole || !audienceType || !originalText) {
      res.status(400).json({ error: 'createdByRole, audienceType, and originalText are required' });
        return;
    }

    const classObjectId = toObjectIdOrNull(req.body.classId);
    const recipientStudentId = toObjectIdOrNull(req.body.recipientStudentId);
    const attachment = req.file
      ? [{
          originalName: req.file.originalname,
          fileName: req.file.filename,
          filePath: req.file.path,
          mimeType: req.file.mimetype,
          size: req.file.size
        }]
      : [];

    const broadcast = await createDraft({
      schoolId: req.body.schoolId || DEFAULT_SCHOOL_ID,
      createdByRole,
      createdBy: req.authUser?.id && Types.ObjectId.isValid(req.authUser.id) ? new Types.ObjectId(req.authUser.id) : undefined,
      audienceType,
      classId: classObjectId ?? undefined,
      recipientStudentId: recipientStudentId ?? undefined,
      recipientStudentName: req.body.recipientStudentName?.toString() || '',
      targetClass: classObjectId ? '' : req.body.classId?.toString() || req.body.targetClass?.toString() || '',
      recipientPhone: req.body.recipientPhone?.toString() || '',
      title: req.body.title,
      originalText,
      draftedText: req.body.draftedText,
      attachments: attachment,
      channels: parseTelegramChannels(req.body.channels)
    });

    res.status(201).json(broadcast);
  } catch (error: any) {
    if (req.file?.path && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({ error: error.message || 'Failed to create broadcast draft' });
  }
});

router.post('/broadcasts/:id/approve', requirePermission(PERMISSIONS.BROADCASTS_APPROVE), async (req: Request, res: Response) => {
  try {
    const broadcast = await Broadcast.findByIdAndUpdate(
      req.params.id,
      {
        approvalStatus: 'approved',
        approvedAt: new Date(),
        ...(req.authUser?.id && Types.ObjectId.isValid(req.authUser.id) ? { approvedBy: new Types.ObjectId(req.authUser.id) } : {}),
        approvedByName: req.authUser?.name || 'Admin',
        ...(req.body.draftedText ? { draftedText: cleanBroadcastText(req.body.draftedText.toString()) } : {})
      },
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

router.post('/broadcasts/:id/send', requirePermission(PERMISSIONS.BROADCASTS_SEND), async (req: Request, res: Response) => {
  try {
    const result = await sendApprovedBroadcast(req.params.id.toString(), req.authUser
      ? { id: req.authUser.id, name: req.authUser.name }
      : undefined);
    res.json(result);
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Failed to send broadcast' });
  }
});

router.get('/broadcasts/:id/recipients', requirePermission(PERMISSIONS.BROADCASTS_VIEW), async (req: Request, res: Response) => {
  try {
    const recipients = await MessageRecipient.find({ broadcastId: req.params.id })
      .sort({ createdAt: 1 });
    res.json(recipients);
  } catch {
    res.status(500).json({ error: 'Failed to fetch broadcast recipients' });
  }
});

router.get('/delivery-logs', requirePermission(PERMISSIONS.DELIVERY_LOGS_VIEW), async (req: Request, res: Response) => {
  try {
    const logs = await DeliveryLog.find(schoolFilter(req))
      .sort({ createdAt: -1 })
      .limit(200);
    res.json(logs);
  } catch {
    res.status(500).json({ error: 'Failed to fetch delivery logs' });
  }
});

router.get('/webhook-events', requirePermission(PERMISSIONS.DELIVERY_LOGS_VIEW), async (req: Request, res: Response) => {
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
