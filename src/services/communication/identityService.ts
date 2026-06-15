import { Types } from 'mongoose';
import User from '../../models/User';
import Class from '../../models/Class';
import {
  findParentByPhone,
  findParentStudents,
  findTeacherByPhone
} from '../verificationService';
import { getPhoneLookupCandidates, normalizePhoneNumber } from '../../utils/phone';
import type { NormalizedInboundMessage, ResolvedSender } from './types';

const findParentUserId = async (phone: string): Promise<Types.ObjectId | undefined> => {
  const candidates = getPhoneLookupCandidates(phone);
  const user = await User.findOne({ phone: { $in: candidates }, role: 'parent' }).select('_id');
  return user?._id as Types.ObjectId | undefined;
};

export const resolveSender = async (
  inbound: NormalizedInboundMessage,
  knownRole?: ResolvedSender['role']
): Promise<ResolvedSender> => {
  const normalizedPhone = normalizePhoneNumber(inbound.participantPhone || '');

  if (knownRole === 'teacher' && normalizedPhone) {
    const teacher = await findTeacherByPhone(normalizedPhone);
    if (teacher) {
      const classRecord = await Class.findOne({
        teacherId: new Types.ObjectId(teacher.teacherId),
        active: true
      }).select('_id className');

      return {
        role: 'teacher',
        name: teacher.name,
        phone: teacher.phone,
        teacherId: new Types.ObjectId(teacher.teacherId),
        classId: classRecord?._id as Types.ObjectId | undefined,
        className: classRecord?.className
      };
    }
  }

  if (knownRole === 'parent' && normalizedPhone) {
    const parent = await findParentByPhone(normalizedPhone);
    if (parent) {
      const children = await findParentStudents(normalizedPhone);
      const firstChild = children[0];
      const classRecord = firstChild
        ? await Class.findOne({ className: firstChild.class, active: true }).select('_id className')
        : null;

      return {
        role: 'parent',
        name: parent.name,
        phone: parent.phone,
        parentId: await findParentUserId(normalizedPhone),
        studentId: firstChild?._id as Types.ObjectId | undefined,
        classId: classRecord?._id as Types.ObjectId | undefined,
        className: firstChild?.class
      };
    }
  }

  if (normalizedPhone && !knownRole) {
    const teacher = await findTeacherByPhone(normalizedPhone);
    if (teacher) {
      return resolveSender(inbound, 'teacher');
    }

    const parent = await findParentByPhone(normalizedPhone);
    if (parent) {
      return resolveSender(inbound, 'parent');
    }
  }

  return {
    role: knownRole === 'visitor' ? 'visitor' : 'unregistered',
    name: inbound.senderName || 'Visitor',
    phone: normalizedPhone
  };
};

