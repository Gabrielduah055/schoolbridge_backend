export const PERMISSIONS = {
  DASHBOARD_VIEW: 'dashboard:view',
  CONVERSATIONS_VIEW: 'conversations:view',
  CONVERSATIONS_REPLY: 'conversations:reply',
  CONVERSATIONS_ASSIGN: 'conversations:assign',
  CONVERSATIONS_RESOLVE: 'conversations:resolve',
  HANDOVERS_VIEW: 'handovers:view',
  HANDOVERS_ASSIGN: 'handovers:assign',
  HANDOVERS_RESOLVE: 'handovers:resolve',
  BROADCASTS_VIEW: 'broadcasts:view',
  BROADCASTS_CREATE: 'broadcasts:create',
  BROADCASTS_APPROVE: 'broadcasts:approve',
  BROADCASTS_SEND: 'broadcasts:send',
  ACADEMIC_YEARS_VIEW: 'academic_years:view',
  ACADEMIC_YEARS_MANAGE: 'academic_years:manage',
  STUDENTS_VIEW: 'students:view',
  STUDENT_ENROLLMENTS_VIEW: 'student_enrollments:view',
  STUDENT_ENROLLMENTS_MANAGE: 'student_enrollments:manage',
  PARENTS_VIEW: 'parents:view',
  TEACHERS_VIEW: 'teachers:view',
  TEACHER_ASSIGNMENTS_VIEW: 'teacher_assignments:view',
  TEACHER_ASSIGNMENTS_MANAGE: 'teacher_assignments:manage',
  CLASSES_VIEW: 'classes:view',
  CLASSES_MANAGE: 'classes:manage',
  SUBJECTS_VIEW: 'subjects:view',
  SUBJECTS_MANAGE: 'subjects:manage',
  KNOWLEDGE_VIEW: 'knowledge:view',
  KNOWLEDGE_MANAGE: 'knowledge:manage',
  CHANNELS_VIEW: 'channels:view',
  DELIVERY_LOGS_VIEW: 'delivery_logs:view',
  SETTINGS_VIEW: 'settings:view',
  SETTINGS_MANAGE: 'settings:manage'
} as const;

export type Permission = typeof PERMISSIONS[keyof typeof PERMISSIONS];

export const HEADMASTER_PERMISSIONS: Permission[] = Object.values(PERMISSIONS);
