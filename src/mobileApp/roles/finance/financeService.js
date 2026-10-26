import { authRequest } from '../../shared/services/authRequest';
import { API_ROOT } from '../../shared/services/apiConfig';
const NOTIFICATION_ROOT = `${API_ROOT}/finance/me/notifications`;

async function request(path, options = {}) {
  try { return await authRequest(path, options, true, true); }
  catch (error) {
    if (error.message?.startsWith('Could not reach the school API')) {
      throw new Error(`Could not reach the school API at ${API_ROOT}. Check that the backend is running and reachable from this device.`);
    }
    throw error;
  }
}

function queryString(filters = {}) {
  const query = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value) query.set(key, value);
  });
  const encoded = query.toString();
  return encoded ? `?${encoded}` : '';
}

function paymentQuery(status, filters = {}) {
  return queryString({
    status,
    studentId: filters.studentId,
    from: filters.from,
    to: filters.to,
    method: filters.method,
  });
}

export const financeApi = {
  getNotifications: async () => {
    const payload = await notificationRequest('');
    return payload.data;
  },
  getNotification: async notificationId =>
    (await notificationRequest(`/${encodeURIComponent(notificationId)}`)).data,
  markNotificationRead: async notificationId =>
    (
      await notificationRequest(`/${encodeURIComponent(notificationId)}/read`, {
        method: 'POST',
      })
    ).data,
  getSummary: filters => request(`/finance/summary${queryString(filters)}`),
  searchStudents: query =>
    request(`/finance/students${queryString({ q: query })}`),
  searchInvoices: filters =>
    request(`/finance/invoices${queryString(filters)}`),
  getDues: filters => request(`/finance/dues${queryString(filters)}`),
  verifyVoucher: code =>
    request(`/finance/vouchers/${encodeURIComponent(code)}/verify`),
  enterPayment: (payment, idempotencyKey) =>
    request('/finance/payments', {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(payment),
    }),
  getPendingPayments: filters =>
    request(`/finance/payments${paymentQuery('pending_verification', filters)}`),
  getPaymentHistory: filters =>
    request(`/finance/payments${paymentQuery('confirmed', filters)}`),
  getParentPaymentReconciliation: () =>
    request('/finance/reconciliation/parent-payments'),
  verifyPayment: paymentId =>
    request(`/finance/payments/${encodeURIComponent(paymentId)}/verify`, {
      method: 'POST',
    }),
  rejectPayment: (paymentId, reason) =>
    request(`/finance/payments/${encodeURIComponent(paymentId)}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
  getReceipts: filters => request(`/finance/receipts${queryString(filters)}`),
  getReceipt: paymentId =>
    request(`/finance/receipts/${encodeURIComponent(paymentId)}`),
  getCollectionReport: filters =>
    request(`/finance/reports/collections${queryString(filters)}`),
  getPayrollStaff: () => request('/finance/payroll/staff'),
  getSalaries: filters => request(`/finance/payroll/salaries${queryString(filters)}`),
  createSalary: salary => request('/finance/payroll/salaries', { method: 'POST', body: JSON.stringify(salary) }),
  approveSalary: salaryId => request(`/finance/payroll/salaries/${encodeURIComponent(salaryId)}/approve`, { method: 'POST' }),
  recordSalaryPayout: (salaryId, payout) => request(`/finance/payroll/salaries/${encodeURIComponent(salaryId)}/payouts`, { method: 'POST', body: JSON.stringify(payout) }),
  getPayslip: salaryId => request(`/finance/payroll/salaries/${encodeURIComponent(salaryId)}/payslip`),
  getExtraCharges: () => request('/finance/extra-charges'),
  createExtraCharge: charge => request('/finance/extra-charges', { method: 'POST', body: JSON.stringify(charge) }),
  applyExtraCharge: chargeId => request(`/finance/extra-charges/${encodeURIComponent(chargeId)}/apply`, { method: 'POST' }),
  getExpenses: () => request('/finance/expenses'),
  getWorkspace: () => request('/finance/workspace'),
  getMonthlyReport: () => request('/finance/reports/monthly'),
  createExpense: async (expense, bill) => {
    if (!bill) return request('/finance/expenses', { method: 'POST', body: JSON.stringify(expense) });
    const body = new FormData();
    Object.entries(expense).forEach(([key, value]) => body.append(key, String(value ?? '')));
    body.append('bill', { uri: bill.uri, name: bill.name, type: bill.type });
    return request('/finance/expenses', { method: 'POST', body });
  },
};

async function notificationRequest(path, options = {}) {
  try { return await authRequest(`${NOTIFICATION_ROOT.slice(API_ROOT.length)}${path}`, options, true, true); }
  catch (error) {
    if (error.message?.startsWith('Could not reach the school API')) throw new Error('Could not reach the Finance notification API.');
    throw error;
  }
}
