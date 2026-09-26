export const MODULES = [
  {
    title: 'My profile',
    screen: 'Profile',
    group: 'More',
    roles: [
      'SUPER_ADMIN',
      'PRINCIPAL',
      'TEACHER',
      'ACCOUNTANT',
      'STUDENT',
      'PARENT',
      'ACADEMIC_COORDINATOR',
      'EXAM_OFFICER',
      'HR',
      'LIBRARIAN',
      'INVENTORY',
      'TRANSPORT',
      'HOSTEL',
      'AUDITOR',
      'IT_SUPPORT',
    ],
  },
  {
    title: 'AI learning',
    screen: 'Lectures',
    group: 'Learning',
    roles: ['SUPER_ADMIN', 'PRINCIPAL', 'TEACHER', 'STUDENT', 'PARENT'],
  },
  {
    title: 'Assignments & reviews',
    screen: 'Assignments',
    group: 'Learning',
    roles: ['SUPER_ADMIN', 'PRINCIPAL', 'TEACHER', 'STUDENT', 'PARENT'],
  },
  {
    title: 'Attendance',
    screen: 'Attendance',
    group: 'Records',
    roles: ['SUPER_ADMIN', 'PRINCIPAL', 'TEACHER', 'STUDENT', 'PARENT'],
  },
  {
    title: 'Classes',
    screen: 'Classes',
    group: 'Records',
    roles: [
      'SUPER_ADMIN',
      'PRINCIPAL',
      'TEACHER',
      'ACADEMIC_COORDINATOR',
      'EXAM_OFFICER',
    ],
  },
  {
    title: 'Students',
    screen: 'Students',
    group: 'Records',
    roles: [
      'SUPER_ADMIN',
      'PRINCIPAL',
      'TEACHER',
      'ACCOUNTANT',
      'PARENT',
      'STUDENT',
    ],
  },
  {
    title: 'Timetable',
    screen: 'Timetable',
    group: 'Records',
    roles: [
      'SUPER_ADMIN',
      'PRINCIPAL',
      'TEACHER',
      'STUDENT',
      'PARENT',
      'ACADEMIC_COORDINATOR',
    ],
  },
  {
    title: 'Notices',
    screen: 'Notices',
    group: 'Records',
    roles: ['SUPER_ADMIN', 'PRINCIPAL', 'TEACHER', 'STUDENT', 'PARENT'],
  },
  {
    title: 'Fees & receipts',
    screen: 'Invoices',
    group: 'Records',
    roles: ['SUPER_ADMIN', 'PRINCIPAL', 'ACCOUNTANT', 'STUDENT', 'PARENT'],
  },
  {
    title: 'Fee plans',
    screen: 'FeePlans',
    group: 'Records',
    roles: ['SUPER_ADMIN', 'ACCOUNTANT', 'PRINCIPAL'],
  },
  {
    title: 'Cash closing', screen: 'CashClosing', group: 'Records',
    roles: ['SUPER_ADMIN', 'ACCOUNTANT'],
  },
  {
    title: 'Users & permissions',
    screen: 'Users',
    group: 'More',
    roles: ['SUPER_ADMIN'],
  },
  {
    title: 'Branches',
    screen: 'Branches',
    group: 'More',
    roles: ['SUPER_ADMIN'],
  },
  {
    title: 'Audit trail',
    screen: 'Audit',
    group: 'More',
    roles: ['SUPER_ADMIN'],
  },
  {
    title: 'School identity',
    screen: 'Settings',
    group: 'More',
    roles: ['SUPER_ADMIN'],
  },
  {
    title: 'Change password',
    screen: 'Password',
    group: 'More',
    roles: [
      'SUPER_ADMIN',
      'PRINCIPAL',
      'TEACHER',
      'ACCOUNTANT',
      'STUDENT',
      'PARENT',
      'ACADEMIC_COORDINATOR',
      'EXAM_OFFICER',
      'HR',
      'LIBRARIAN',
      'INVENTORY',
      'TRANSPORT',
      'HOSTEL',
      'AUDITOR',
      'IT_SUPPORT',
    ],
  },
];

export const ROLES_BY_SCREEN = Object.fromEntries(
  MODULES.map(({ screen, roles }) => [screen, roles]),
);
ROLES_BY_SCREEN.Home = [
  'SUPER_ADMIN',
  'PRINCIPAL',
  'TEACHER',
  'ACCOUNTANT',
  'STUDENT',
  'PARENT',
  'ACADEMIC_COORDINATOR',
  'EXAM_OFFICER',
  'HR',
  'LIBRARIAN',
  'INVENTORY',
  'TRANSPORT',
  'HOSTEL',
  'AUDITOR',
  'IT_SUPPORT',
];
ROLES_BY_SCREEN.Profile = ROLES_BY_SCREEN.Home;
ROLES_BY_SCREEN.LectureDetail = MODULES.find(
  item => item.screen === 'Lectures',
).roles;
ROLES_BY_SCREEN.AssignmentDetail = MODULES.find(
  item => item.screen === 'Assignments',
).roles;
ROLES_BY_SCREEN.InvoiceDetail = MODULES.find(
  item => item.screen === 'Invoices',
).roles;
