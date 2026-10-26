import { authRequest } from '../../shared/services/authRequest';
import { API_ROOT as API_BASE } from '../../shared/services/apiConfig';
const API_ROOT = `${API_BASE}/students/me`;

const request = (path, options) => authRequest('/students/me' + path, options);
const featureRequest = (path, options) => request('/features' + path, options);

function dateQuery(filters = {}) {
  const params = new URLSearchParams();
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  const query = params.toString();
  return query ? `?${query}` : '';
}

export const studentApi = {
  getProfile: () => request(''),
  getTimetable: () => request('/timetable'),
  getAttendance: filters => request(`/attendance${dateQuery(filters)}`),
  getResults: () => request('/results'),
  getProgress: () => request('/progress'),
  getFees: () => request('/fees'),
  getHomework: () => request('/homework'),
  getHomeworkDetails: homeworkId =>
    request(`/homework/${encodeURIComponent(homeworkId)}`),
  getApplications: () => request('/applications'),
  getNotifications: () => request('/notifications'),
  getNotification: notificationId =>
    request(`/notifications/${encodeURIComponent(notificationId)}`),
  markNotificationRead: notificationId =>
    request(`/notifications/${encodeURIComponent(notificationId)}/read`, {
      method: 'POST',
    }),
  submitApplication: application =>
    request('/applications', {
      method: 'POST',
      body: JSON.stringify(application),
    }),
  getSubmissions: homeworkId =>
    request(`/homework/${encodeURIComponent(homeworkId)}/submissions`),
  submitHomework: (homeworkId, submission = {}) => {
    const body = new FormData();
    if (submission.text?.trim()) body.append('text', submission.text.trim());
    if (submission.uri && submission.name) {
      body.append('file', {
        uri: submission.uri,
        name: submission.name,
        type: submission.type,
      });
    }
    return request(`/homework/${encodeURIComponent(homeworkId)}/submissions`, {
      method: 'POST',
      body,
    });
  },
  getSubmissionFile: submissionId =>
    `${API_ROOT}/submissions/${encodeURIComponent(submissionId)}/file`,
  getCalendar: () => featureRequest('/calendar'),
  getEvents: () => featureRequest('/events'),
  requestEvent: eventId => featureRequest(`/events/${encodeURIComponent(eventId)}/requests`, { method: 'POST' }),
  getPtm: () => featureRequest('/ptm'),
  requestPtm: value => featureRequest('/ptm/requests', { method: 'POST', body: JSON.stringify(value) }),
  getResources: kind => featureRequest(`/resources${kind ? `?kind=${encodeURIComponent(kind)}` : ''}`),
  updateResourceProgress: (resourceId, percent) => featureRequest(`/resources/${encodeURIComponent(resourceId)}/progress`, { method: 'POST', body: JSON.stringify({ percent }) }),
  getNotes: () => featureRequest('/notes'),
  saveNote: value => featureRequest('/notes', { method: 'POST', body: JSON.stringify(value) }),
  getFlashcards: () => featureRequest('/flashcards'),
  saveFlashcard: value => featureRequest('/flashcards', { method: 'POST', body: JSON.stringify(value) }),
  getRevisionPlans: () => featureRequest('/revision-planner'),
  saveRevisionPlan: value => featureRequest('/revision-planner', { method: 'POST', body: JSON.stringify(value) }),
  getQuizzes: () => featureRequest('/quizzes'),
  submitQuiz: (quizId, answers) => featureRequest(`/quizzes/${encodeURIComponent(quizId)}/attempts`, { method: 'POST', body: JSON.stringify({ answers }) }),
  getDocuments: () => featureRequest('/documents'),
  getHelpdeskTickets: () => featureRequest('/helpdesk'),
  createHelpdeskTicket: value => featureRequest('/helpdesk', { method: 'POST', body: JSON.stringify(value) }),
  getTransportHistory: () => featureRequest('/transport/history'),
  getTransportTracking: () => featureRequest('/transport/tracking'),
};
