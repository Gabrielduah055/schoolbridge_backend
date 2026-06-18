import 'dotenv/config';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import connectDB from '../config/db';
import AdminUser, { type AdminRole } from '../models/AdminUser';
import { DEFAULT_SCHOOL_ID } from '../config/school';
import { HEADMASTER_PERMISSIONS } from '../config/permissions';

const main = async () => {
  const name = process.env.SEED_ADMIN_NAME?.trim() || 'Headmaster';
  const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD || '';
  const role: AdminRole = 'headmaster';
  const schoolId = process.env.SEED_ADMIN_SCHOOL_ID?.trim() || DEFAULT_SCHOOL_ID;

  if (!email || !password) {
    throw new Error('SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD are required.');
  }

  await connectDB();

  const existing = await AdminUser.findOne({ email, schoolId });
  if (existing) {
    console.log(`Admin user already exists for ${email}. Skipping.`);
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  await AdminUser.create({
    name,
    email,
    passwordHash,
    role,
    permissions: HEADMASTER_PERMISSIONS,
    schoolId,
    isActive: true
  });

  console.log(`Seeded ${role} admin user for ${email}.`);
};

main()
  .catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
