import { Router } from 'express';
import type { Request, Response } from 'express';
import multer from 'multer';
import * as XLSX from 'xlsx';
import fs from 'fs';
import Student from '../models/Students';
import User from '../models/User';
import Fee from '../models/Fee';

const router = Router();
const uploadDir = './uploads/';

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const upload = multer({
  dest: uploadDir,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedMimeTypes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'text/csv',
      'application/csv'
    ];

    if (allowedMimeTypes.includes(file.mimetype)) {
      cb(null, true);
      return;
    }

    cb(new Error('Student import only supports Excel or CSV files.'));
  }
});

const cleanupFile = (filePath?: string) => {
  if (filePath && fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
};

const normalizeColumnName = (value: string) =>
  value.toLowerCase().replace(/[\s_-]/g, '');

const getColumnValue = (row: Record<string, any>, candidates: string[]) => {
  for (const candidate of candidates) {
    if (row[candidate] !== undefined && row[candidate] !== null) {
      return row[candidate];
    }
  }

  const normalizedRow = new Map(
    Object.entries(row).map(([key, value]) => [normalizeColumnName(key), value])
  );

  for (const candidate of candidates) {
    const value = normalizedRow.get(normalizeColumnName(candidate));
    if (value !== undefined && value !== null) {
      return value;
    }
  }

  return undefined;
};

const toText = (value: any) => value === undefined || value === null ? '' : value.toString().trim();
const toNumber = (value: any) => {
  const numeric = Number(toText(value).replace(/[^\d.-]/g, ''));
  return Number.isFinite(numeric) ? numeric : 0;
};

// Get all students
router.get('/', async (req: Request, res: Response) => {
  try {
    const students = await Student.find({ status: 'active' })
      .sort({ class: 1, name: 1 });
    res.json(students);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch students' });
  }
});

// Add single student
router.post('/', async (req: Request, res: Response) => {
  try {
    const { 
      name, admissionNumber, class: studentClass,
      age, parentName, parentPhone, parentEmail,
      termFee
    } = req.body;

    // Create student
    const student = new Student({
      name, admissionNumber, 
      class: studentClass,
      age, parentName, parentPhone, parentEmail
    });
    await student.save();

    // Create parent user
    if (parentPhone) {
      await User.findOneAndUpdate(
        { phone: parentPhone },
        {
          name: parentName,
          phone: parentPhone,
          email: parentEmail,
          role: 'parent',
          studentId: student._id
        },
        { upsert: true, new: true }
      );
    }

    // Create fee record
    if (termFee) {
      const fee = new Fee({
        studentId: student._id,
        termFee: Number(termFee),
        outstanding: Number(termFee),
        status: 'unpaid'
      });
      await fee.save();
    }

    res.json({ 
      message: 'Student added successfully!', 
      student 
    });

  } catch (error) {
    console.error('Add student error:', error);
    res.status(500).json({ error: 'Failed to add student' });
  }
});

// Import students from Excel
router.post('/import', upload.single('file'), 
  async (req: Request, res: Response) => {
  try {
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    const workbook = XLSX.readFile(file.path);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json<Record<string, any>>(sheet);

    if (data.length === 0) {
      cleanupFile(file.path);
      res.status(400).json({ error: 'Excel file is empty or has no data' });
      return;
    }

    let imported = 0;
    let skipped = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const [index, row] of data.entries()) {
      try {
        const rowNumber = index + 2;
        const name = toText(getColumnValue(row, ['Student Name', 'Name', 'name', 'STUDENT NAME']));
        const studentClass = toText(getColumnValue(row, ['Class', 'class', 'CLASS']));
        const admissionNumber = toText(getColumnValue(row, ['Admission No', 'Admission Number', 'admissionNumber']));
        const parentName = toText(getColumnValue(row, ['Parent Name', 'parentName', 'PARENT NAME']));
        const parentPhone = toText(getColumnValue(row, ['Parent Phone', 'parentPhone', 'PARENT PHONE', 'Phone']));
        const parentEmail = toText(getColumnValue(row, ['Parent Email', 'parentEmail', 'Email']));
        const age = toNumber(getColumnValue(row, ['Age', 'age']));
        const termFee = toNumber(getColumnValue(row, ['Term Fee', 'termFee', 'Fee']));

        if (!name || !studentClass) {
          errors.push(`Row ${rowNumber} skipped - missing student name or class`);
          skipped++;
          continue;
        }

        const duplicateQuery = admissionNumber
          ? { admissionNumber }
          : { name, class: studentClass };
        const existing = await Student.findOne(duplicateQuery);

        if (existing) {
          skipped++;
          continue;
        }

        const student = new Student({
          name,
          admissionNumber,
          class: studentClass,
          age,
          parentName,
          parentPhone,
          parentEmail,
          status: 'active'
        });
        await student.save();

        // Create parent user
        if (parentPhone) {
          await User.findOneAndUpdate(
            { phone: parentPhone },
            {
              name: parentName || 'Parent',
              phone: parentPhone,
              email: parentEmail,
              role: 'parent',
              studentId: student._id,
              isActive: true
            },
            { upsert: true, new: true }
          );
        }

        // Create fee record
        if (termFee > 0) {
          const fee = new Fee({
            studentId: student._id,
            termFee,
            amountPaid: 0,
            outstanding: termFee,
            status: 'unpaid'
          });
          await fee.save();
        }

        imported++;
      } catch (err: any) {
        errors.push(`Row ${index + 2} failed - ${err.message}`);
        failed++;
      }
    }

    cleanupFile(file.path);

    res.json({ 
      message: 'Import complete!',
      imported,
      skipped,
      failed,
      total: data.length,
      errors: errors.slice(0, 5)
    });

  } catch (error: any) {
    cleanupFile(req.file?.path);
    console.error('Import error:', error);
    res.status(500).json({ 
      error: error.message || 'Import failed. Please check your Excel format.' 
    });
  }
});

// Update student
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const student = await Student.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true }
    );
    res.json(student);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update' });
  }
});

// Delete student
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    await Student.findByIdAndUpdate(
      req.params.id, 
      { status: 'inactive' }
    );
    res.json({ message: 'Student removed' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete' });
  }
});

export default router;
