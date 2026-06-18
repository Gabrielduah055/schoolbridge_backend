import mongoose, { Schema, Document } from 'mongoose';
import { DEFAULT_SCHOOL_ID } from '../config/school';

export interface ISubject extends Document {
  schoolId: string;
  name: string;
  code: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const SubjectSchema = new Schema<ISubject>(
  {
    schoolId: { type: String, default: DEFAULT_SCHOOL_ID, index: true },
    name: { type: String, required: true, trim: true },
    code: { type: String, default: '', trim: true },
    active: { type: Boolean, default: true, index: true }
  },
  { timestamps: true }
);

SubjectSchema.index({ schoolId: 1, name: 1 }, { unique: true });
SubjectSchema.index({ schoolId: 1, code: 1 });

export default mongoose.model<ISubject>('Subject', SubjectSchema);
