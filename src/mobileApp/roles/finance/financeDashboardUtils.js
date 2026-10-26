export const initialFinanceForm = {
  invoiceId: '',
  amount: '',
  method: 'cash',
  reference: '',
};

export function formatMoney(amount, currency = 'PKR') {
  return `${currency} ${Number(amount || 0).toLocaleString()}`;
}

export function financeErrorMessage(error) {
  const message = error?.message || 'Finance request failed.';
  if (
    /trusted user context|finance access is required|branch context/i.test(
      message,
    )
  ) {
    return `Finance integration blocked: partner authentication must provide trusted req.user.id, role "finance", and req.user.branchId. ${message}`;
  }
  return message;
}
