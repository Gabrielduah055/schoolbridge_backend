import { Types } from 'mongoose';
import Broadcast from '../../models/Broadcast';
import MessageRecipient from '../../models/MessageRecipient';
import { DEFAULT_SCHOOL_ID } from '../../config/school';

interface CreateDraftArgs {
  schoolId?: string;
  createdBy?: Types.ObjectId;
  createdByRole: 'teacher' | 'admin';
  audienceType: 'whole_school' | 'class' | 'individual' | 'teachers' | 'parents';
  classId?: Types.ObjectId;
  title?: string;
  originalText: string;
  draftedText?: string;
  channels?: Array<'telegram' | 'whatsapp'>;
}

export const createDraft = async ({
  schoolId = DEFAULT_SCHOOL_ID,
  createdBy,
  createdByRole,
  audienceType,
  classId,
  title = '',
  originalText,
  draftedText = '',
  channels = ['telegram']
}: CreateDraftArgs) => {
  return Broadcast.create({
    schoolId,
    createdBy,
    createdByRole,
    audienceType,
    classId,
    title,
    originalText,
    draftedText: draftedText || originalText,
    approvalStatus: 'draft',
    status: 'draft',
    channels
  });
};

export const sendApprovedBroadcast = async (broadcastId: string) => {
  const broadcast = await Broadcast.findById(broadcastId);

  if (!broadcast) {
    throw new Error('Broadcast not found');
  }

  if (broadcast.approvalStatus !== 'approved') {
    throw new Error('Broadcast must be approved before sending');
  }

  const recipientCount = await MessageRecipient.countDocuments({ broadcastId: broadcast._id });
  broadcast.status = recipientCount > 0 ? 'sending' : 'failed';
  broadcast.sentAt = new Date();
  await broadcast.save();

  return broadcast;
};

