import { rolePages, previewRolePages } from '../theme/hiraTheme';
import { features } from '../features/featureScreens';
import { getFeatureProvider } from '../features/featureProviders';

const directPages = {
  Student: new Set([
    'Home', 'Profile', 'Timetable', 'Attendance', 'Attendance Calendar', 'Results', 'Progress',
    'Homework', 'Applications', 'Notifications', 'Inbox',
  ]),
  Parent: new Set([
    'Home', 'My children', 'Attendance', 'Attendance Calendar', 'Timetable', 'Homework', 'Results',
    'Progress', 'Fees', 'Applications', 'Notifications', 'Inbox', 'Track My Child', 'Travel History',
    'Transport & Alerts', 'Pickup & Early Exit', 'Academic Report', 'Monthly Feedback',
    'Student Progress Tracking', 'Personal & Behaviour Report', 'Student Fees', 'Receipt Details',
    'Leave Request',
  ]),
  Finance: new Set([
    'Home', 'Student search', 'Outstanding dues', 'Invoices',
    'Voucher verification', 'Payment entry', 'Pending verification',
    'Payment history', 'Receipts', 'Collection report', 'Notifications', 'Inbox',
  ]),
};
// This live page deliberately advertises the absent calendar API rather than
// showing sample events or providing fake actions.
const knownUnintegratedPages = {
  Parent: new Set(['Academic Calendar', 'PTM & Appointments']),
};

test.each(['Student', 'Parent', 'Finance'])(
  '%s production menu contains only implemented pages',
  role => {
    for (const page of rolePages[role]) {
      if (directPages[role].has(page)) continue;
      expect(features[page]).toBeDefined();
      if (knownUnintegratedPages[role]?.has(page)) continue;
      const provider = getFeatureProvider(role, page, '002');
      if (!provider) throw new Error(`${role} menu page has no live provider: ${page}`);
      expect(typeof provider.load === 'function' || typeof provider.submit === 'function').toBe(true);
    }
  },
);

test('external-service concepts stay in explicit developer preview only', () => {
  const unavailable = {
    Student: ['AI Tutor', 'Live Classroom', 'Messages', 'Helpdesk'],
    Parent: ['Online Payment', 'Messages', 'Helpdesk'],
    Finance: ['Advance Balances', 'Finance Requests', 'Exceptions & Closing', 'Messages'],
  };
  for (const [role, pages] of Object.entries(unavailable)) {
    for (const page of pages) {
      expect(rolePages[role]).not.toContain(page);
      expect(previewRolePages[role]).toContain(page);
    }
  }
});
