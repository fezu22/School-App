import { authRequest } from './authRequest';

export const applicationReviewApi = {
  list: () => authRequest('/applications'),
  review: (applicationId, status, note = '') =>
    authRequest(`/applications/${encodeURIComponent(applicationId)}/review`, {
      method: 'POST',
      body: JSON.stringify({ status, note }),
    }),
  listPrincipalApplications: () => authRequest('/applications/principal'),
  submitToPrincipal: ({ title, category = 'leave_request', message }) =>
    authRequest('/applications/principal', {
      method: 'POST',
      body: JSON.stringify({ title, category, message }),
    }),
  reviewPrincipalApplication: (applicationId, status, note = '') =>
    authRequest(`/applications/principal/${encodeURIComponent(applicationId)}/review`, {
      method: 'POST',
      body: JSON.stringify({ status, note }),
    }),
  listSuperAdminApplications: () => authRequest('/applications/super-admin'),
  submitToSuperAdmin: ({ title, category = 'campus_escalation', message }) =>
    authRequest('/applications/super-admin', {
      method: 'POST',
      body: JSON.stringify({ title, category, message }),
    }),
  reviewSuperAdminApplication: (applicationId, status, note = '') =>
    authRequest(`/applications/super-admin/${encodeURIComponent(applicationId)}/review`, {
      method: 'POST',
      body: JSON.stringify({ status, note }),
    }),
};
