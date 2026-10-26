import { extraPages } from '../features/featureScreens';

export const theme = {
  background: '#FFF9EF',
  paper: '#FFFEFA',
  ink: '#282940',
  muted: '#92918A',
  primary: '#4857B5',
  lavender: '#EEEDFF',
  border: '#E6E2D7',
  gold: '#FFE4AA',
  shadow: {
    shadowColor: '#5E5039',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.09,
    shadowRadius: 9,
    elevation: 3,
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
};
export const bottomPages = {
  Parent: ['Home', 'Progress', 'Inbox'],
  Student: ['Home', 'Timetable', 'Homework', 'Inbox'],
  Finance: ['Home', 'Invoices', 'Receipts', 'Inbox'],
  Teacher: ['Home', 'Classes', 'Inbox'],
  Principal: ['Home', 'Reports', 'Inbox'],
  'Super Admin': ['Home', 'Schools', 'Inbox'],
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
