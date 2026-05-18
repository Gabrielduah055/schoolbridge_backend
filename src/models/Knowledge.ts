import mongoose, { Schema, Document } from 'mongoose';

export interface IKnowledge extends Document {
  category: string;
  fileName: string;
  content: string;
  fileSize: string;
  isActive: boolean;
  uploadedAt: Date;
}

const KnowledgeSchema = new Schema({
  category: { 
    type: String, 
    enum: [
      'fee_structure',
      'student_records', 
      'school_calendar',
      'school_policies',
      'exam_timetable',
      'class_timetable',
      'teacher_directory',
      'other'
    ],
    required: true 
  },
  fileName: { type: String, required: true },
  content: { type: String, required: true },
  fileSize: { type: String, default: '' },
  isActive: { type: Boolean, default: true },
  uploadedAt: { type: Date, default: Date.now }
});

export default mongoose.model<IKnowledge>('Knowledge', KnowledgeSchema);