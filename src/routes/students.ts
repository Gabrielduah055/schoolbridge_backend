import { Router } from 'express';
import type { Request, Response } from 'express';
import multer from 'multer';
import * as XLSX from 'xlsx';
import Student from '../models/students';
import User from '../models/User';
import Fee from '../models/fee';

const router = Router();
const upload = multer({ dest: './uploads/' });

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
    const data = XLSX.utils.sheet_to_json(sheet) as any[];

    let imported = 0;
    let failed = 0;

    for (const row of data) {
      try {
        const student = new Student({
          name: row['Student Name'] || row['name'],
          admissionNumber: row['Admission No'] || row['admissionNumber'] || '',
          class: row['Class'] || row['class'],
          age: row['Age'] || row['age'] || 0,
          parentName: row['Parent Name'] || row['parentName'] || '',
          parentPhone: row['Parent Phone'] || row['parentPhone'] || '',
          parentEmail: row['Parent Email'] || row['parentEmail'] || '',
        });
        await student.save();

        // Create parent user
        if (student.parentPhone) {
          await User.findOneAndUpdate(
            { phone: student.parentPhone },
            {
              name: student.parentName,
              phone: student.parentPhone,
              email: student.parentEmail,
              role: 'parent',
              studentId: student._id
            },
            { upsert: true }
          );
        }

        // Create fee record
        const termFee = row['Term Fee'] || row['termFee'];
        if (termFee) {
          const fee = new Fee({
            studentId: student._id,
            termFee: Number(termFee),
            outstanding: Number(termFee),
            status: 'unpaid'
          });
          await fee.save();
        }

        imported++;
      } catch (err) {
        failed++;
      }
    }

    res.json({ 
      message: `Import complete! ${imported} students added, ${failed} failed.`,
      imported,
      failed
    });

  } catch (error) {
    console.error('Import error:', error);
    res.status(500).json({ error: 'Import failed' });
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
