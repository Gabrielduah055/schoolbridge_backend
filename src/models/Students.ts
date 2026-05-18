import mongoose, { Schema, Document } from 'mongoose';

export interface IStudent extends Document {
  name: string;
  admissionNumber: string;
  class: string;
  age: number;
  parentName: string;
  parentPhone: string;
  parentEmail: string;
  dateEnrolled: Date;
  status: 'active' | 'inactive';
  createdAt: Date;
}

const StudentSchema = new Schema({
  name: { type: String, required: true },
  admissionNumber: { type: String, default: '' },
  class: { type: String, required: true },
  age: { type: Number, default: 0 },
  parentName: { type: String, default: '' },
  parentPhone: { type: String, default: '' },
  parentEmail: { type: String, default: '' },
  dateEnrolled: { type: Date, default: Date.now },
  status: { 
    type: String, 
    enum: ['active', 'inactive'], 
    default: 'active' 
  },
  createdAt: { type: Date, default: Date.now }
});

export default mongoose.model<IStudent>('Student', StudentSchema);