import mongoose, { Schema, Document } from 'mongoose';

export interface TeacherSubjectAssignment {
  className: string;
  subject: string;
}

export interface ITeacher extends Document {
  fullName: string;
  phone: string;        // normalized to 0XXXXXXXXX format
  email?: string;
  subject?: string;
  subjectAssignments?: TeacherSubjectAssignment[];
  role: 'teacher';
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const TeacherSchema = new Schema<ITeacher>(
  {
    fullName: { type: String, required: true, trim: true },
    phone: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true
    },
    email: { type: String, default: '', trim: true },
    subject: { type: String, default: '', trim: true },
    subjectAssignments: {
      type: [{
        className: { type: String, required: true, trim: true },
        subject: { type: String, required: true, trim: true }
      }],
      default: []
    },
    role: { type: String, enum: ['teacher'], default: 'teacher' },
    active: { type: Boolean, default: true, index: true }
  },
  { timestamps: true }
);

export default mongoose.model<ITeacher>('Teacher', TeacherSchema);
