import mongoose, { Schema, Document, Types } from 'mongoose';
import { DEFAULT_SCHOOL_ID } from '../config/school';

export interface ITeacherAssignment extends Document {
  schoolId: string;
  academicYearId: Types.ObjectId;
  teacherId: Types.ObjectId;
  classId: Types.ObjectId;
  assignmentType: 'class_teacher' | 'subject_teacher';
  subjectId?: Types.ObjectId;
  subjectName: string;
  startDate: Date;
  endDate?: Date | null;
  isActive: boolean;
  createdBy?: Types.ObjectId;
  createdByName: string;
  endedBy?: Types.ObjectId;
  endedByName: string;
  endedAt?: Date | null;
  endReason: string;
  createdAt: Date;
  updatedAt: Date;
}

const TeacherAssignmentSchema = new Schema<ITeacherAssignment>(
  {
    schoolId: { type: String, default: DEFAULT_SCHOOL_ID, index: true },
    academicYearId: { type: Schema.Types.ObjectId, ref: 'AcademicYear', required: true, index: true },
    teacherId: { type: Schema.Types.ObjectId, ref: 'Teacher', required: true, index: true },
    classId: { type: Schema.Types.ObjectId, ref: 'Class', required: true, index: true },
    assignmentType: {
      type: String,
      enum: ['class_teacher', 'subject_teacher'],
      required: true,
      index: true
    },
    subjectId: { type: Schema.Types.ObjectId, ref: 'Subject', default: null, index: true },
    subjectName: { type: String, default: '', trim: true },
    startDate: { type: Date, default: Date.now },
    endDate: { type: Date, default: null },
    isActive: { type: Boolean, default: true, index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'AdminUser', default: null },
    createdByName: { type: String, default: '' },
    endedBy: { type: Schema.Types.ObjectId, ref: 'AdminUser', default: null },
    endedByName: { type: String, default: '' },
    endedAt: { type: Date, default: null },
    endReason: { type: String, default: '' }
  },
  { timestamps: true }
);

TeacherAssignmentSchema.index({ schoolId: 1, academicYearId: 1, teacherId: 1 });
TeacherAssignmentSchema.index({ schoolId: 1, academicYearId: 1, classId: 1, assignmentType: 1, isActive: 1 });
TeacherAssignmentSchema.index(
  { schoolId: 1, academicYearId: 1, classId: 1, assignmentType: 1, isActive: 1 },
  {
    unique: true,
    partialFilterExpression: { assignmentType: 'class_teacher', isActive: true }
  }
);

TeacherAssignmentSchema.pre('validate', function validateSubjectTeacher() {
  if (this.assignmentType === 'subject_teacher' && !this.subjectId && !this.subjectName) {
    throw new Error('Subject teacher assignment requires subjectId or subjectName');
  }
});

export default mongoose.model<ITeacherAssignment>('TeacherAssignment', TeacherAssignmentSchema);
