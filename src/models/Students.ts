import mongoose, { Schema, Document } from 'mongoose';

export interface IStudent extends Document {
  name: string;
  admissionNumber: string;
  class: string;
  age: number;
  gender: string;
  dateOfBirth?: Date;
  admissionType: string;
  admissionStatus: string;
  parentName: string;
  parentPhone: string;
  parentPhone2: string;
  parentEmail: string;
  relationship: string;
  residentialArea: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  medicalCondition: string;
  allergies: string;
  medicationRequired: string;
  bloodGroup: string;
  doctorHospitalContact: string;
  specialLearningNeed: string;
  transportNeeded: boolean;
  feedingService: boolean;
  notes: string;
  admissionDocuments: {
    birthCertificate?: string;
    passportPhotos?: string;
    previousSchoolReport?: string;
    transferLetter?: string;
    healthImmunizationRecord?: string;
    parentGuardianId?: string;
    emergencyContactDetails?: string;
    otherDocuments?: string;
  };
  dateEnrolled: Date;
  status: 'active' | 'inactive';
  createdAt: Date;
}

const StudentSchema = new Schema({
  name: { type: String, required: true },
  admissionNumber: { type: String, default: '' },
  class: { type: String, required: true },
  age: { type: Number, default: 0 },
  gender: { type: String, default: '' },
  dateOfBirth: { type: Date, default: null },
  admissionType: { type: String, default: '' },
  admissionStatus: { type: String, default: '' },
  parentName: { type: String, default: '' },
  parentPhone: { type: String, default: '' },
  parentPhone2: { type: String, default: '' },
  parentEmail: { type: String, default: '' },
  relationship: { type: String, default: '' },
  residentialArea: { type: String, default: '' },
  emergencyContactName: { type: String, default: '' },
  emergencyContactPhone: { type: String, default: '' },
  medicalCondition: { type: String, default: '' },
  allergies: { type: String, default: '' },
  medicationRequired: { type: String, default: '' },
  bloodGroup: { type: String, default: '' },
  doctorHospitalContact: { type: String, default: '' },
  specialLearningNeed: { type: String, default: '' },
  transportNeeded: { type: Boolean, default: false },
  feedingService: { type: Boolean, default: false },
  notes: { type: String, default: '' },
  admissionDocuments: {
    birthCertificate: { type: String, default: '' },
    passportPhotos: { type: String, default: '' },
    previousSchoolReport: { type: String, default: '' },
    transferLetter: { type: String, default: '' },
    healthImmunizationRecord: { type: String, default: '' },
    parentGuardianId: { type: String, default: '' },
    emergencyContactDetails: { type: String, default: '' },
    otherDocuments: { type: String, default: '' }
  },
  dateEnrolled: { type: Date, default: Date.now },
  status: { 
    type: String, 
    enum: ['active', 'inactive'], 
    default: 'active' 
  },
  createdAt: { type: Date, default: Date.now }
});

// Indexes — these fields are queried on every parent message
StudentSchema.index({ status: 1, parentPhone: 1 });
StudentSchema.index({ status: 1, parentPhone2: 1 });
StudentSchema.index({ admissionNumber: 1 }, { unique: true, sparse: true });

export default mongoose.model<IStudent>('Student', StudentSchema);
