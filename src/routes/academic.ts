import { Router } from 'express';
import type { Request, Response } from 'express';
import { Types } from 'mongoose';
import Class from '../models/Class';
import TeacherAssignment from '../models/TeacherAssignment';
import { DEFAULT_SCHOOL_ID } from '../config/school';
import { PERMISSIONS } from '../config/permissions';
import { requirePermission } from '../middleware/authorization';
import {
  closeAcademicYear,
  createAcademicYear,
  getActiveAcademicYear,
  listAcademicYears,
  setActiveAcademicYear
} from '../services/academic/academicYearService';
import {
  createClass,
  getClassById,
  getClassParents,
  getClassSummary,
  listClasses,
  updateClass
} from '../services/academic/classService';
import { createSubject, listSubjects, updateSubject } from '../services/academic/subjectService';
import {
  assignClassTeacher,
  assignSubjectTeacher,
  endTeacherAssignment,
  getClassSubjectTeachers,
  getClassTeacher,
  getTeacherAssignments,
  getTeacherCommunicationScope,
  listTeacherAssignments,
  replaceClassTeacher
} from '../services/academic/teacherAssignmentService';
import {
  enrollStudent,
  getStudentCurrentEnrollment,
  getStudentEnrollments,
  listStudentEnrollments,
  promoteStudents
} from '../services/academic/studentEnrollmentService';

const router = Router();

const schoolId = (req: Request) => req.authUser?.schoolId || DEFAULT_SCHOOL_ID;
const actor = (req: Request) => ({ id: req.authUser?.id, name: req.authUser?.name });
const dateOrNow = (value: unknown) => value ? new Date(value.toString()) : new Date();
const param = (req: Request, key = 'id') => req.params[key]?.toString() || '';

const asyncRoute = (handler: (req: Request, res: Response) => Promise<void>) =>
  async (req: Request, res: Response) => {
    try {
      await handler(req, res);
    } catch (error: any) {
      res.status(400).json({ error: error.message || 'Academic request failed' });
    }
  };

router.get('/academic-years', requirePermission(PERMISSIONS.ACADEMIC_YEARS_VIEW), asyncRoute(async (req, res) => {
  res.json(await listAcademicYears(schoolId(req)));
}));

router.post('/academic-years', requirePermission(PERMISSIONS.ACADEMIC_YEARS_MANAGE), asyncRoute(async (req, res) => {
  const { name, startDate, endDate, isActive } = req.body;
  if (!name || !startDate || !endDate) {
    res.status(400).json({ error: 'name, startDate, and endDate are required' });
    return;
  }
  res.status(201).json(await createAcademicYear({
    schoolId: schoolId(req),
    name,
    startDate: new Date(startDate),
    endDate: new Date(endDate),
    isActive: Boolean(isActive)
  }));
}));

router.get('/academic-years/active', requirePermission(PERMISSIONS.ACADEMIC_YEARS_VIEW), asyncRoute(async (req, res) => {
  const active = await getActiveAcademicYear(schoolId(req));
  res.json(active || null);
}));

router.post('/academic-years/:id/set-active', requirePermission(PERMISSIONS.ACADEMIC_YEARS_MANAGE), asyncRoute(async (req, res) => {
  res.json(await setActiveAcademicYear(param(req), schoolId(req)));
}));

router.post('/academic-years/:id/close', requirePermission(PERMISSIONS.ACADEMIC_YEARS_MANAGE), asyncRoute(async (req, res) => {
  res.json(await closeAcademicYear(param(req), schoolId(req)));
}));

router.get('/classes', requirePermission(PERMISSIONS.CLASSES_VIEW), asyncRoute(async (req, res) => {
  const rows = await Promise.all((await listClasses(schoolId(req))).map(async (classRecord) => {
    const summary = await getClassSummary((classRecord._id as Types.ObjectId).toString(), schoolId(req));
    const classTeacher = summary.classTeacher as any;
    return {
      id: classRecord._id,
      _id: classRecord._id,
      name: classRecord.name || classRecord.className,
      className: classRecord.name || classRecord.className,
      level: classRecord.level,
      section: classRecord.section,
      displayName: classRecord.displayName,
      active: classRecord.active,
      teacher: classTeacher?.teacherId?.fullName || 'Not assigned',
      classTeacher,
      studentCount: summary.studentCount,
      parentContactCount: summary.parentContactCount,
      subjectTeachersCount: summary.subjectTeachers.length,
      recentBroadcastCount: summary.recentBroadcastCount,
      warnings: summary.warnings
    };
  }));
  res.json(rows);
}));

router.post('/classes', requirePermission(PERMISSIONS.CLASSES_MANAGE), asyncRoute(async (req, res) => {
  if (!req.body.name && !req.body.className) {
    res.status(400).json({ error: 'name is required' });
    return;
  }
  res.status(201).json(await createClass({
    schoolId: schoolId(req),
    name: req.body.name || req.body.className,
    level: req.body.level,
    section: req.body.section,
    displayName: req.body.displayName,
    active: req.body.active
  }));
}));

router.get('/classes/:id', requirePermission(PERMISSIONS.CLASSES_VIEW), asyncRoute(async (req, res) => {
  const classRecord = await getClassById(param(req), schoolId(req));
  if (!classRecord) {
    res.status(404).json({ error: 'Class not found' });
    return;
  }
  res.json(classRecord);
}));

router.patch('/classes/:id', requirePermission(PERMISSIONS.CLASSES_MANAGE), asyncRoute(async (req, res) => {
  res.json(await updateClass(param(req), req.body, schoolId(req)));
}));

router.get('/classes/:id/summary', requirePermission(PERMISSIONS.CLASSES_VIEW), asyncRoute(async (req, res) => {
  res.json(await getClassSummary(param(req), schoolId(req)));
}));

router.get('/classes/:id/parents', requirePermission(PERMISSIONS.CLASSES_VIEW), asyncRoute(async (req, res) => {
  const classRecord = await getClassById(param(req), schoolId(req));
  res.json({ className: classRecord?.name || classRecord?.className || '', parents: await getClassParents(param(req), schoolId(req)) });
}));

router.get('/classes/:id/teachers', requirePermission(PERMISSIONS.TEACHER_ASSIGNMENTS_VIEW), asyncRoute(async (req, res) => {
  const activeYear = await getActiveAcademicYear(schoolId(req));
  if (!activeYear) {
    res.json({ activeAcademicYear: null, classTeacher: null, subjectTeachers: [] });
    return;
  }
  res.json({
    activeAcademicYear: activeYear,
    classTeacher: await getClassTeacher(param(req), activeYear._id as Types.ObjectId, schoolId(req)),
    subjectTeachers: await getClassSubjectTeachers(param(req), activeYear._id as Types.ObjectId, schoolId(req))
  });
}));

router.get('/subjects', requirePermission(PERMISSIONS.SUBJECTS_VIEW), asyncRoute(async (req, res) => {
  res.json(await listSubjects(schoolId(req)));
}));

router.post('/subjects', requirePermission(PERMISSIONS.SUBJECTS_MANAGE), asyncRoute(async (req, res) => {
  if (!req.body.name) {
    res.status(400).json({ error: 'name is required' });
    return;
  }
  res.status(201).json(await createSubject({ schoolId: schoolId(req), ...req.body }));
}));

router.patch('/subjects/:id', requirePermission(PERMISSIONS.SUBJECTS_MANAGE), asyncRoute(async (req, res) => {
  res.json(await updateSubject(param(req), req.body, schoolId(req)));
}));

router.get('/teacher-assignments', requirePermission(PERMISSIONS.TEACHER_ASSIGNMENTS_VIEW), asyncRoute(async (req, res) => {
  res.json(await listTeacherAssignments({
    schoolId: schoolId(req),
    academicYearId: req.query.academicYearId?.toString(),
    teacherId: req.query.teacherId?.toString(),
    classId: req.query.classId?.toString(),
    assignmentType: req.query.assignmentType as any,
    isActive: req.query.isActive === undefined ? undefined : req.query.isActive === 'true'
  }));
}));

router.post('/teacher-assignments/class-teacher', requirePermission(PERMISSIONS.TEACHER_ASSIGNMENTS_MANAGE), asyncRoute(async (req, res) => {
  res.status(201).json(await assignClassTeacher({
    schoolId: schoolId(req),
    academicYearId: req.body.academicYearId,
    teacherId: req.body.teacherId,
    classId: req.body.classId,
    startDate: dateOrNow(req.body.startDate),
    actor: actor(req)
  }));
}));

router.post('/teacher-assignments/replace-class-teacher', requirePermission(PERMISSIONS.TEACHER_ASSIGNMENTS_MANAGE), asyncRoute(async (req, res) => {
  res.status(201).json(await replaceClassTeacher({
    schoolId: schoolId(req),
    academicYearId: req.body.academicYearId,
    classId: req.body.classId,
    newTeacherId: req.body.newTeacherId,
    startDate: dateOrNow(req.body.startDate),
    reason: req.body.reason,
    actor: actor(req)
  }));
}));

router.post('/teacher-assignments/subject-teacher', requirePermission(PERMISSIONS.TEACHER_ASSIGNMENTS_MANAGE), asyncRoute(async (req, res) => {
  res.status(201).json(await assignSubjectTeacher({
    schoolId: schoolId(req),
    academicYearId: req.body.academicYearId,
    teacherId: req.body.teacherId,
    classId: req.body.classId,
    subjectId: req.body.subjectId,
    subjectName: req.body.subjectName,
    startDate: dateOrNow(req.body.startDate),
    actor: actor(req)
  }));
}));

router.post('/teacher-assignments/:id/end', requirePermission(PERMISSIONS.TEACHER_ASSIGNMENTS_MANAGE), asyncRoute(async (req, res) => {
  res.json(await endTeacherAssignment(param(req), {
    schoolId: schoolId(req),
    reason: req.body.reason,
    endDate: dateOrNow(req.body.endDate),
    actor: actor(req)
  }));
}));

router.get('/teachers/:id/assignments', requirePermission(PERMISSIONS.TEACHER_ASSIGNMENTS_VIEW), asyncRoute(async (req, res) => {
  res.json(await getTeacherAssignments(param(req), schoolId(req)));
}));

router.get('/teachers/:id/communication-scope', requirePermission(PERMISSIONS.TEACHER_ASSIGNMENTS_VIEW), asyncRoute(async (req, res) => {
  res.json(await getTeacherCommunicationScope(param(req), schoolId(req)));
}));

router.get('/student-enrollments', requirePermission(PERMISSIONS.STUDENT_ENROLLMENTS_VIEW), asyncRoute(async (req, res) => {
  res.json(await listStudentEnrollments({
    schoolId: schoolId(req),
    academicYearId: req.query.academicYearId?.toString(),
    studentId: req.query.studentId?.toString(),
    classId: req.query.classId?.toString(),
    status: req.query.status?.toString()
  }));
}));

router.post('/student-enrollments', requirePermission(PERMISSIONS.STUDENT_ENROLLMENTS_MANAGE), asyncRoute(async (req, res) => {
  res.status(201).json(await enrollStudent({
    schoolId: schoolId(req),
    academicYearId: req.body.academicYearId,
    studentId: req.body.studentId,
    classId: req.body.classId,
    startDate: dateOrNow(req.body.startDate),
    actor: actor(req)
  }));
}));

router.get('/students/:id/enrollments', requirePermission(PERMISSIONS.STUDENT_ENROLLMENTS_VIEW), asyncRoute(async (req, res) => {
  res.json(await getStudentEnrollments(param(req), schoolId(req)));
}));

router.get('/students/:id/current-enrollment', requirePermission(PERMISSIONS.STUDENT_ENROLLMENTS_VIEW), asyncRoute(async (req, res) => {
  res.json(await getStudentCurrentEnrollment(param(req), schoolId(req)));
}));

router.post('/student-enrollments/promote', requirePermission(PERMISSIONS.STUDENT_ENROLLMENTS_MANAGE), asyncRoute(async (req, res) => {
  res.json(await promoteStudents({
    schoolId: schoolId(req),
    fromAcademicYearId: req.body.fromAcademicYearId,
    toAcademicYearId: req.body.toAcademicYearId,
    moves: req.body.moves || [],
    actor: actor(req)
  }));
}));

router.get('/academic-setup/status', requirePermission(PERMISSIONS.DASHBOARD_VIEW), asyncRoute(async (req, res) => {
  const activeYear = await getActiveAcademicYear(schoolId(req));
  const activeClassCount = await Class.countDocuments({ schoolId: schoolId(req), active: true });
  const activeAssignmentCount = activeYear
    ? await TeacherAssignment.countDocuments({ schoolId: schoolId(req), academicYearId: activeYear._id, isActive: true })
    : 0;
  res.json({
    activeAcademicYear: activeYear,
    activeClassCount,
    activeAssignmentCount,
    warnings: {
      noActiveAcademicYear: !activeYear
    }
  });
}));

export default router;
