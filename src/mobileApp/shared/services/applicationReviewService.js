import { authRequest } from './authRequest';

export const applicationReviewApi = {
  list: () => authRequest('/applications'),
  review: (applicationId, status, note = '') =>
    authRequest(`/applications/${encodeURIComponent(applicationId)}/review`, {
      method: 'POST',
      body: JSON.stringify({ status, note }),
    }),
};
