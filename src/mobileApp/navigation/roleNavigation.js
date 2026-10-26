const groups = [
  {
    title: 'Transport & Safety',
    routes: {
      Parent: [
        'Track My Child',
        'Travel History',
        'Transport & Alerts',
        'Pickup & Early Exit',
      ],
      Student: [
        'Track My Child',
        'Travel History',
        'Transport & Alerts',
        'Pickup & Early Exit',
      ],
    },
  },
  {
    title: 'Learning',
    routes: {
      Parent: [
        'Homework',
        'Learning Resources',
        'Recorded Lessons',
        'Catch-up Workspace',
        'Notes & Flashcards',
        'Quiz',
        'Revision Planner',
        'AI Tutor',
        'Live Classroom',
      ],
      Student: [
        'Homework',
        'Learning Resources',
        'Recorded Lessons',
        'Catch-up Workspace',
        'Notes & Flashcards',
        'Quiz',
        'Revision Planner',
        'AI Tutor',
        'Live Classroom',
      ],
    },
  },
  {
    title: 'Reports',
    routes: {
      Parent: [
        'Results',
        'Academic Report',
        'Personal & Behaviour Report',
        'Monthly Feedback',
        'Student Progress Tracking',
      ],
      Student: ['Results', 'Academic Report', 'Monthly Feedback', 'Progress'],
    },
  },
  {
    title: 'Calendar & Meetings',
    routes: {
      Parent: [
        'Academic Calendar',
        'Attendance Calendar',
        'School Events',
        'Sports & Activities',
        'PTM & Appointments',
      ],
      Student: [
        'Academic Calendar',
        'Attendance Calendar',
        'School Events',
        'Sports & Activities',
      ],
    },
  },
  {
    title: 'Fees & Payments',
    routes: {
      Parent: ['Student Fees', 'Receipt Details', 'Installment Requests'],
      Student: ['Student Fees'],
    },
  },
];

export function getRoleNavigationGroups(role, authorizedPages = []) {
  const allowed = new Set(authorizedPages);
  return groups
    .map(group => ({
      title: group.title,
      routes: (group.routes[role] || []).filter(route => allowed.has(route)),
    }))
    .filter(group => group.routes.length > 0);
}

export function resolveRoleNavigation(role, page, authorizedPages = []) {
  const roleGroups = getRoleNavigationGroups(role, authorizedPages);
  const aliases = {
    Parent: {
      Fees: 'Student Fees',
      'Online Payment': 'Student Fees',
      Progress: 'Student Progress Tracking',
    },
    Student: {},
  };
  if (
    ['Parent', 'Student'].includes(role) &&
    page === 'Messages' &&
    authorizedPages.includes('Inbox')
  ) {
    return { page: 'Inbox', route: '' };
  }
  const canonicalPage = aliases[role]?.[page];
  if (canonicalPage && authorizedPages.includes(canonicalPage))
    page = canonicalPage;
  else if (canonicalPage && !authorizedPages.includes(page))
    return { page, route: '' };
  const group = roleGroups.find(
    item => item.title === page || item.routes.includes(page),
  );
  if (!group) return { page, route: '' };
  return {
    page: group.title,
    route: group.routes.includes(page)
      ? page
      : group.title === 'Transport & Safety'
      ? group.routes[0]
      : '',
  };
}

export function buildRoleDrawerPages(role, authorizedPages = []) {
  const uniquePages = [...new Set(authorizedPages)];
  if (!['Parent', 'Student'].includes(role)) return uniquePages;
  const roleGroups = getRoleNavigationGroups(role, authorizedPages);
  const groupedRoutes = new Set(roleGroups.flatMap(group => group.routes));
  const aliases =
    role === 'Parent'
      ? new Set(['Fees', 'Online Payment', 'Progress', 'Messages'])
      : new Set(['Messages']);
  const utilityPages = uniquePages.filter(
    page => !aliases.has(page) && !groupedRoutes.has(page),
  );
  const primaryPages =
    role === 'Parent'
      ? [
          'Home',
          'My children',
          'Attendance',
          'Timetable',
          'Applications',
          'Notifications',
          'Inbox',
        ]
      : [
          'Home',
          'Profile',
          'Attendance',
          'Timetable',
          'Applications',
          'Notifications',
          'Inbox',
        ];
  const primary = primaryPages.filter(page => utilityPages.includes(page));
  const remaining = utilityPages.filter(page => !primary.includes(page));
  return [...primary, ...roleGroups.map(group => group.title), ...remaining];
}

export function defaultRoleNavigationRoute(role, page, authorizedPages = []) {
  return (
    getRoleNavigationGroups(role, authorizedPages).find(
      group => group.title === page,
    )?.routes[0] || ''
  );
}

// Transport owns its bottom tabs; all other sections retain the app navigation.
export function sectionBottomTabs(role, page, authorizedPages = []) {
  if (role !== 'Parent' || page !== 'Transport & Safety') return null;
  const group = getRoleNavigationGroups(role, authorizedPages).find(
    item => item.title === page,
  );
  const labels = {
    'Track My Child': 'Track',
    'Travel History': 'History',
    'Transport & Alerts': 'Alerts',
    'Pickup & Early Exit': 'Pickup',
  };
  return group
    ? group.routes.map(route => ({ route, label: labels[route] || route }))
    : null;
}
