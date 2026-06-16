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
  STUDENTS_VIEW: 'students:view',
  PARENTS_VIEW: 'parents:view',
  TEACHERS_VIEW: 'teachers:view',
  CLASSES_VIEW: 'classes:view',
  KNOWLEDGE_VIEW: 'knowledge:view',
  KNOWLEDGE_MANAGE: 'knowledge:manage',
  CHANNELS_VIEW: 'channels:view',
  DELIVERY_LOGS_VIEW: 'delivery_logs:view',
  SETTINGS_VIEW: 'settings:view',
  SETTINGS_MANAGE: 'settings:manage'
} as const;

export type Permission = typeof PERMISSIONS[keyof typeof PERMISSIONS];

export const HEADMASTER_PERMISSIONS: Permission[] = Object.values(PERMISSIONS);
