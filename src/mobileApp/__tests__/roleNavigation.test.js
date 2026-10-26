import { previewRolePages, rolePages } from '../theme/hiraTheme';
import {
  buildRoleDrawerPages,
  defaultRoleNavigationRoute,
  getRoleNavigationGroups,
  resolveRoleNavigation,
} from '../navigation/roleNavigation';

test.each(['Parent', 'Student'])(
  '%s drawer consolidates related routes without removing their destinations',
  role => {
    const pages = previewRolePages[role];
    const drawer = buildRoleDrawerPages(role, pages);
    const groups = getRoleNavigationGroups(role, pages);

    expect(new Set(drawer).size).toBe(drawer.length);
    expect(drawer).toContain('Inbox');
    expect(drawer).toContain('Notifications');
    expect(drawer).not.toContain('Messages');
    for (const group of groups) expect(drawer).toContain(group.title);
    for (const group of groups) {
      for (const oldRoute of group.routes)
        expect(drawer).not.toContain(oldRoute);
    }
  },
);

test('legacy destinations resolve to the correct authorized tab and retain their page', () => {
  const pages = previewRolePages.Parent;
  expect(resolveRoleNavigation('Parent', 'Travel History', pages)).toEqual({
    page: 'Transport & Safety',
    route: 'Travel History',
  });
  expect(resolveRoleNavigation('Parent', 'Homework', pages)).toEqual({
    page: 'Learning',
    route: 'Homework',
  });
  expect(resolveRoleNavigation('Parent', 'PTM & Appointments', pages)).toEqual({
    page: 'Calendar & Meetings',
    route: 'PTM & Appointments',
  });
  expect(resolveRoleNavigation('Parent', 'Student Fees', pages)).toEqual({
    page: 'Fees & Payments',
    route: 'Student Fees',
  });
  expect(resolveRoleNavigation('Parent', 'Fees', pages)).toEqual({
    page: 'Fees & Payments',
    route: 'Student Fees',
  });
  expect(resolveRoleNavigation('Parent', 'Online Payment', pages)).toEqual({
    page: 'Fees & Payments',
    route: 'Student Fees',
  });
  expect(resolveRoleNavigation('Parent', 'Progress', pages)).toEqual({
    page: 'Reports',
    route: 'Student Progress Tracking',
  });
  expect(resolveRoleNavigation('Parent', 'Messages', pages)).toEqual({
    page: 'Inbox',
    route: '',
  });
  const drawer = buildRoleDrawerPages('Parent', pages);
  for (const alias of ['Fees', 'Online Payment', 'Progress', 'Messages']) {
    expect(drawer).not.toContain(alias);
  }
});

test('only role-authorized categories and tabs are shown', () => {
  const studentGroups = getRoleNavigationGroups('Student', rolePages.Student);
  expect(studentGroups.map(group => group.title)).toEqual([
    'Learning',
    'Reports',
    'Calendar & Meetings',
    'Fees & Payments',
  ]);
  expect(
    studentGroups.find(group => group.title === 'Learning').routes,
  ).toEqual(['Homework']);
  expect(
    resolveRoleNavigation('Student', 'Track My Child', rolePages.Student),
  ).toEqual({
    page: 'Track My Child',
    route: '',
  });
  expect(buildRoleDrawerPages('Student', rolePages.Student)).not.toContain(
    'Transport & Safety',
  );
});

test('group navigation opens an overview without auto-opening a subpage', () => {
  const pages = previewRolePages.Student;
  expect(resolveRoleNavigation('Student', 'Reports', pages)).toEqual({
    page: 'Reports',
    route: '',
  });
  expect(defaultRoleNavigationRoute('Student', 'Learning', pages)).toBe(
    'Homework',
  );
});

test('Recorded Lessons remains in Learning and separate from Inbox messages', () => {
  const pages = previewRolePages.Parent;
  expect(resolveRoleNavigation('Parent', 'Recorded Lessons', pages)).toEqual({
    page: 'Learning',
    route: 'Recorded Lessons',
  });
  expect(resolveRoleNavigation('Parent', 'Inbox', pages)).toEqual({
    page: 'Inbox',
    route: '',
  });
  const drawer = buildRoleDrawerPages('Parent', pages);
  expect(drawer).toContain('Learning');
  expect(drawer).toContain('Inbox');
  expect(drawer).not.toContain('Recorded Lessons');
});
