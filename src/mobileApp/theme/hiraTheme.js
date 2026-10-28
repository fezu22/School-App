import { extraPages } from '../features/featureScreens';

export const theme = {
  background: '#FAF8F5',
  paper: '#FFFFFF',
  mutedContainer: '#F5F2EB',
  ink: '#0F172A',
  muted: '#475569',
  primary: '#0D9488',
  secondary: '#1E3A8A',
  lavender: '#CCFBF1',
  border: '#EDE8DF',
  gold: '#FEF3C7',
  amber: '#D97706',
  shadow: {
    shadowColor: '#1E293B',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 12,
    elevation: 2,
  },
};

export const rolePages = {
  Parent: [
    'Home',
    'My children',
    'Attendance',
    'Timetable',
    'Homework',
    'Results',
    'Progress',
    'Fees',
    'Applications',
    'Notifications',
    'Inbox',
  ],
  Student: [
    'Home',
    'Profile',
    'Timetable',
    'Attendance',
    'Results',
    'Progress',
    'Homework',
    'Applications',
    'Notifications',
    'Inbox',
  ],
  Finance: [
    'Home',
    'Student search',
    'Outstanding dues',
    'Invoices',
    'Voucher verification',
    'Payment entry',
    'Pending verification',
    'Payment history',
    'Receipts',
    'Collection report',
    'Notifications',
    'Inbox',
  ],
  Teacher: [
    'Home',
    'Classes',
    'Attendance',
    'Homework',
    'Teachers DLP',
    'Applications',
    'Inbox',
  ],
  Principal: [
    'Home',
    'Teachers',
    'Teachers DLP',
    'Reports',
    'Applications',
    'Inbox',
  ],
  'Super Admin': [
    'Home',
    'Schools',
    'Users',
    'Events',
    'Reports',
    'Applications',
    'Inbox',
  ],
  'Ultra Admin': [
    'Home',
    'Schools',
    'Subscriptions',
    'Platform Audit',
  ],
};

export const bottomPages = {
  Parent: ['Home', 'Progress', 'Inbox'],
  Student: ['Home', 'Timetable', 'Homework', 'Inbox'],
  Finance: ['Home', 'Invoices', 'Receipts', 'Inbox'],
  Teacher: ['Home', 'Classes', 'Inbox'],
  Principal: ['Home', 'Reports', 'Inbox'],
  'Super Admin': ['Home', 'Schools', 'Inbox'],
  'Ultra Admin': ['Home', 'Schools', 'Subscriptions', 'Platform Audit'],
};

const connectedExtraPages = {
  Parent: [
    'Track My Child',
    'Travel History',
    'Transport & Alerts',
    'Pickup & Early Exit',
    'Academic Report',
    'Monthly Feedback',
    'Student Progress Tracking',
    'Personal & Behaviour Report',
    'Academic Calendar',
    'PTM & Appointments',
    'Student Fees',
    'Receipt Details',
    'Attendance Calendar',
    'Leave Request',
  ],
  Student: [
    'Academic Report',
    'Monthly Feedback',
    'Student Fees',
    'Attendance Calendar',
    'Leave Request',
  ],
  Finance: [
    'Student Ledger',
    'Voucher Scan',
    'Receipt Details',
    'Finance Reports',
  ],
};

Object.entries(connectedExtraPages).forEach(([role, pages]) => {
  rolePages[role] = [
    ...rolePages[role].filter(page => page !== 'Inbox'),
    ...pages,
    'Inbox',
  ];
});

export const previewRolePages = Object.fromEntries(
  Object.entries(rolePages).map(([role, pages]) => [
    role,
    [
      ...pages.filter(page => page !== 'Inbox'),
      ...(extraPages[role] || []).filter(page => !pages.includes(page)),
      'Inbox',
    ],
  ]),
);
