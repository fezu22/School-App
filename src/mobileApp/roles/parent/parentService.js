import { authRequest } from '../../shared/services/authRequest';

async function request(path, options = {}) {
  try {
    return await authRequest(`/parents/me${path}`, options);
  } catch (error) {
    if (error.message?.startsWith('Could not reach the school API')) {
      throw new Error('Could not reach the Parent API. Check that the backend is running and reachable from this device.');
    }
    throw error;
  }
}

const featureRequest = (childId, path, options) =>
  request(`/children/${encodeURIComponent(childId)}/features${path}`, options);

export const parentApi = {
  getChildren: () => request('/children'),
  getNotifications: () => request('/notifications'),
  markNotificationRead: notificationId =>
    request(`/notifications/${encodeURIComponent(notificationId)}/read`, {
      method: 'POST',
    }),
  openNotification: notificationId =>
    request(`/notifications/${encodeURIComponent(notificationId)}`),
  getNotification: notificationId =>
    request(`/notifications/${encodeURIComponent(notificationId)}`),
  getChild: childId => request(`/children/${encodeURIComponent(childId)}`),
  getAttendance: (childId, filters = {}) => {
    const query = new URLSearchParams();
    if (filters.from) query.set('from', filters.from);
    if (filters.to) query.set('to', filters.to);
    const suffix = query.toString();
    return request(
      `/children/${encodeURIComponent(childId)}/attendance${suffix ? `?${suffix}` : ''}`,
    );
  },
  getTimetable: childId =>
    request(`/children/${encodeURIComponent(childId)}/timetable`),
  getHomework: childId =>
    request(`/children/${encodeURIComponent(childId)}/homework`),
  getResults: childId =>
    request(`/children/${encodeURIComponent(childId)}/results`),
  getProgress: childId =>
    request(`/children/${encodeURIComponent(childId)}/progress`),
  getFees: childId => request(`/children/${encodeURIComponent(childId)}/fees`),
  getFeeCheckoutConfig: () => request('/payments/checkout/config'),
  createFeeCheckout: (childId, invoiceId, method) =>
    request(
      `/payments/children/${encodeURIComponent(childId)}/invoices/${encodeURIComponent(invoiceId)}/checkout`,
      { method: 'POST', body: JSON.stringify({ method }) },
    ),
  getFeePaymentStatus: paymentId =>
    request(`/payments/transactions/${encodeURIComponent(paymentId)}/status`),
  createBatchCheckout: ({ invoices, method, idempotencyKey }) =>
    request('/payments/checkout/batch', {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({ invoices, method }),
    }),
  getBatchPaymentStatus: batchId =>
    request(`/payments/batches/${encodeURIComponent(batchId)}/status`),
  getFeedback: childId =>
    request(`/children/${encodeURIComponent(childId)}/feedback`),
  getApplications: childId =>
    request(`/children/${encodeURIComponent(childId)}/applications`),
  submitApplication: (childId, application) =>
    request(`/children/${encodeURIComponent(childId)}/applications`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(application),
    }),
  getCalendar: childId => featureRequest(childId, '/calendar'),
  getEvents: childId => featureRequest(childId, '/events'),
  requestEvent: (childId, eventId) => featureRequest(childId, `/events/${encodeURIComponent(eventId)}/requests`, { method: 'POST' }),
  getPtm: childId => featureRequest(childId, '/ptm'),
  requestPtm: (childId, value) => featureRequest(childId, '/ptm/requests', { method: 'POST', body: JSON.stringify(value) }),
  getResources: (childId, kind) => featureRequest(childId, `/resources${kind ? `?kind=${encodeURIComponent(kind)}` : ''}`),
  getDocuments: childId => featureRequest(childId, '/documents'),
  recordConsent: (childId, documentId, version, decision) => featureRequest(childId, `/documents/${encodeURIComponent(documentId)}/consent`, { method: 'POST', body: JSON.stringify({ version, decision }) }),
  getHelpdeskTickets: childId => featureRequest(childId, '/helpdesk'),
  createHelpdeskTicket: (childId, value) => featureRequest(childId, '/helpdesk', { method: 'POST', body: JSON.stringify(value) }),
  getTransportHistory: childId => featureRequest(childId, '/transport/history'),
  getTransportTracking: childId => featureRequest(childId, '/transport/tracking'),
};
