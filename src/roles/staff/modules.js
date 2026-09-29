// [title, screen, allowedRoles]
export const staffModules = [
  [
    'AI learning',
    'Lectures',
    ['SUPER_ADMIN', 'PRINCIPAL', 'TEACHER'],
  ],
  ['Users', 'Users', ['SUPER_ADMIN']],
  ['Branches', 'Branches', ['SUPER_ADMIN']],
  [
    'Classes',
    'Classes',
    [
      'SUPER_ADMIN',
      'PRINCIPAL',
      'TEACHER',
      'ACADEMIC_COORDINATOR',
      'EXAM_OFFICER',
    ],
  ],
  ['Students', 'Students', ['SUPER_ADMIN', 'PRINCIPAL', 'TEACHER']],
  ['Attendance', 'Attendance', ['SUPER_ADMIN', 'PRINCIPAL', 'TEACHER']],
  ['Assignments', 'Assignments', ['SUPER_ADMIN', 'PRINCIPAL', 'TEACHER']],
  [
    'Timetable',
    'Timetable',
    ['SUPER_ADMIN', 'PRINCIPAL', 'TEACHER', 'ACADEMIC_COORDINATOR'],
  ],
  ['Notices', 'Notices'],
  ['Fees & receipts', 'Invoices', ['SUPER_ADMIN', 'PRINCIPAL']],
  ['Audit trail', 'Audit', ['SUPER_ADMIN']],
  ['School settings', 'Settings', ['SUPER_ADMIN']],
];
