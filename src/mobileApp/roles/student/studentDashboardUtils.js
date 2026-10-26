export const asList = value => (Array.isArray(value) ? value : []);

const resourcesByPage = {
  Profile: ['profile'],
  Timetable: ['profile', 'timetable'],
  Learning: ['profile', 'timetable'],
  Attendance: ['profile', 'attendance'],
  Results: ['profile', 'results'],
  Progress: ['profile', 'progress'],
  Homework: ['profile', 'homework'],
  Applications: ['profile', 'applications'],
  Fees: ['profile'],
};

export function requestedResources(page) {
  return resourcesByPage[page] || [
    'profile',
    'timetable',
    'attendance',
    'results',
    'progress',
    'homework',
    'applications',
  ];
}

export function isPastDeadline(value) {
  if (!value) return false;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(String(value));
  const deadline = new Date(dateOnly ? `${value}T23:59:59.999Z` : value);
  return Number.isFinite(deadline.getTime()) && Date.now() > deadline.getTime();
}
