import Subject from '../../models/Subject';
import { DEFAULT_SCHOOL_ID } from '../../config/school';

export const listSubjects = (schoolId = DEFAULT_SCHOOL_ID) =>
  Subject.find({ schoolId }).sort({ active: -1, name: 1 });

export const createSubject = (input: {
  schoolId?: string;
  name: string;
  code?: string;
  active?: boolean;
}) => Subject.create({
  schoolId: input.schoolId || DEFAULT_SCHOOL_ID,
  name: input.name,
  code: input.code || '',
  active: input.active !== false
});

export const updateSubject = (id: string, input: Partial<{
  name: string;
  code: string;
  active: boolean;
}>, schoolId = DEFAULT_SCHOOL_ID) =>
  Subject.findOneAndUpdate({ _id: id, schoolId }, { $set: input }, { new: true });
