import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { pick } from '@react-native-documents/picker';
import { financeApi } from './financeService';
import { financePreview } from '../../shared/data/previewData';
import { API_ROOT } from '../../shared/services/apiConfig';
import { getAuthHeaders } from '../../shared/services/authSession';
import { financeErrorMessage, formatMoney } from './financeDashboardUtils';

const C = {
  bg: '#FFF9EF',
  paper: '#FFFEFA',
  ink: '#282940',
  muted: '#92918A',
  blue: '#4857B5',
  lavender: '#EEEDFF',
  line: '#E6E2D7',
  green: '#168A62',
  greenBg: '#E8F6EF',
  amber: '#B7791F',
  amberBg: '#FFF2D8',
  red: '#B42318',
  redBg: '#FDEBE8',
  sky: '#E7F3FA',
  white: '#FFFFFF',
};
const TABS = [
  { id: 'overview', label: 'Overview', icon: '◫' },
  { id: 'fees', label: 'Fees & challans', icon: '▤' },
  { id: 'charges', label: 'Extra charges', icon: '+' },
  { id: 'review', label: 'Verify payments', icon: '✓' },
  { id: 'receipts', label: 'Receipts', icon: '▧' },
  { id: 'payroll', label: 'Staff payroll', icon: '♙' },
  { id: 'expenses', label: 'Expenses', icon: '↗' },
  { id: 'reports', label: 'Reports', icon: '▥' },
];
const EXPENSE_CATEGORIES = [
  ['utilities', 'Utilities'],
  ['maintenance', 'Maintenance'],
  ['stationery', 'Stationery'],
  ['events', 'Events'],
  ['lab_supplies', 'Lab supplies'],
  ['vendor_payments', 'Vendor'],
  ['other', 'Other'],
];
const CHARGE_CATEGORIES = [
  ['tuition', 'Tuition'],
  ['transport', 'Transport'],
  ['exam', 'Exam'],
  ['event', 'Event'],
  ['books', 'Books'],
  ['activity', 'Activity'],
  ['other', 'Other'],
];
const METHODS = [
  ['cash', 'Cash'],
  ['bank_transfer', 'Bank transfer'],
  ['card', 'Card'],
  ['cheque', 'Cheque'],
  ['other', 'Other'],
];
const ACTIVE_MONTH = new Date().toISOString().slice(0, 7);
const MONTH_START = `${ACTIVE_MONTH}-01`;
const MONTH_END = new Date().toISOString().slice(0, 10);

const valueOf = result => result?.data ?? result;
const statusTone = status => {
  const normalized = String(status || '').toLowerCase();
  if (['paid', 'confirmed', 'applied', 'recorded'].includes(normalized))
    return 'green';
  if (
    [
      'partial',
      'partially_paid',
      'pending_verification',
      'draft',
      'approved',
    ].includes(normalized)
  )
    return 'amber';
  if (['overdue', 'rejected', 'failed', 'cancelled'].includes(normalized))
    return 'red';
  return 'blue';
};

function Button({
  label,
  onPress,
  tone = 'primary',
  disabled = false,
  compact = false,
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.button,
        styles[`button_${tone}`],
        compact && styles.buttonCompact,
        disabled && styles.disabled,
      ]}
    >
      <Text
        style={[
          styles.buttonText,
          tone !== 'primary' && styles[`buttonText_${tone}`],
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}
function Input({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  multiline = false,
  autoCapitalize = 'sentences',
}) {
  return (
    <View style={styles.inputWrap}>
      {label ? <Text style={styles.inputLabel}>{label}</Text> : null}
      <TextInput
        accessibilityLabel={label || placeholder}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={C.muted}
        keyboardType={keyboardType}
        multiline={multiline}
        autoCapitalize={autoCapitalize}
        style={[styles.input, multiline && styles.inputMultiline]}
      />
    </View>
  );
}
function Chip({ label, selected, onPress, tone = 'default' }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={[
        styles.chip,
        selected && styles.chipSelected,
        tone === 'green' && styles.chipGreen,
      ]}
    >
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
        {label}
      </Text>
    </Pressable>
  );
}
function Card({ children, style }) {
  return <View style={[styles.card, style]}>{children}</View>;
}
function SectionTitle({ title, detail, right }) {
  return (
    <View style={styles.sectionHeader}>
      <View style={styles.sectionHeadingBox}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {detail ? <Text style={styles.sectionDetail}>{detail}</Text> : null}
      </View>
      {right}
    </View>
  );
}
function Badge({ value }) {
  const tone = statusTone(value);
  return (
    <View style={[styles.badge, styles[`badge_${tone}`]]}>
      <Text style={[styles.badgeText, styles[`badgeText_${tone}`]]}>
        {String(value || '—').replaceAll('_', ' ')}
      </Text>
    </View>
  );
}
function Empty({ children }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyIcon}>✦</Text>
      <Text style={styles.emptyText}>{children}</Text>
    </View>
  );
}

function initialTab(page) {
  const match = String(page || '').toLowerCase();
  if (match.includes('payroll') || match.includes('salary')) return 'payroll';
  if (match.includes('expense')) return 'expenses';
  if (match.includes('report') || match.includes('closing')) return 'reports';
  if (
    match.includes('pending') ||
    match.includes('verification') ||
    match.includes('reconcil')
  )
    return 'review';
  if (match.includes('receipt')) return 'receipts';
  if (
    match.includes('invoice') ||
    match.includes('dues') ||
    match.includes('voucher') ||
    match.includes('student search') ||
    match.includes('payment entry')
  )
    return 'fees';
  if (match.includes('payment')) return 'review';
  if (match.includes('extra charge')) return 'charges';
  return 'overview';
}

export default function FinanceDashboard({
  previewOnly = false,
  searchQuery = '',
  page = 'Home',
}) {
  const [tab, setTab] = useState(() => initialTab(page));
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(!previewOnly);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [summary, setSummary] = useState(
    previewOnly ? financePreview.summary : null,
  );
  const [workspace, setWorkspace] = useState(null);
  const [monthly, setMonthly] = useState([]);
  const [invoices, setInvoices] = useState(
    previewOnly ? financePreview.invoices : [],
  );
  const [dues, setDues] = useState(previewOnly ? financePreview.dues : []);
  const [pending, setPending] = useState(
    previewOnly ? financePreview.pendingPayments : [],
  );
  const [reconciliation, setReconciliation] = useState([]);
  const [history, setHistory] = useState(
    previewOnly ? financePreview.paymentHistory : [],
  );
  const [receipts, setReceipts] = useState(
    previewOnly ? financePreview.receipts : [],
  );
  const [report, setReport] = useState(
    previewOnly ? financePreview.report : null,
  );
  const [charges, setCharges] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [staff, setStaff] = useState([]);
  const [salaries, setSalaries] = useState([]);
  const [studentQuery, setStudentQuery] = useState('');
  const [invoiceFilter, setInvoiceFilter] = useState('All');
  const [gradeFilter, setGradeFilter] = useState('');
  const [invoiceQuery, setInvoiceQuery] = useState(searchQuery || '');
  const [rejectionReason, setRejectionReason] = useState('');
  const [workingId, setWorkingId] = useState('');
  const [chargeForm, setChargeForm] = useState({
    title: '',
    category: 'exam',
    perStudentAmount: '',
    dueDate: '',
    grade: 'all',
    description: '',
  });
  const [expenseForm, setExpenseForm] = useState({
    title: '',
    category: 'utilities',
    amount: '',
    vendor: '',
    expenseDate: new Date().toISOString().slice(0, 10),
    method: 'cash',
    notes: '',
  });
  const [expenseBill, setExpenseBill] = useState(null);
  const [salaryForm, setSalaryForm] = useState({
    staffUserId: '',
    month: new Date().toISOString().slice(0, 7),
    baseSalary: '',
    deductions: '0',
    deductionReason: '',
  });
  const [payoutForm, setPayoutForm] = useState({
    method: 'bank_transfer',
    reference: '',
  });
  const [selectedSalary, setSelectedSalary] = useState('');
  const [payslip, setPayslip] = useState(null);
  const [receiptDetails, setReceiptDetails] = useState(null);
  const [viewingExpense, setViewingExpense] = useState(null);
  const [studentSearchResults, setStudentSearchResults] = useState([]);
  const [paymentEntry, setPaymentEntry] = useState({
    invoiceId: '',
    amount: '',
    method: 'cash',
    reference: '',
  });
  const paymentKey = useRef({ fingerprint: '', value: '' });
  const [voucherCode, setVoucherCode] = useState('');
  const [voucherResult, setVoucherResult] = useState(null);

  const loadData = useCallback(
    async (silent = false) => {
      if (previewOnly) return;
      if (!silent) setLoading(true);
      setError('');
      const entries = [
        ['workspace', () => financeApi.getWorkspace()],
        ['monthly', () => financeApi.getMonthlyReport()],
        [
          'summary',
          () => financeApi.getSummary({ from: MONTH_START, to: MONTH_END }),
        ],
        ['invoices', () => financeApi.searchInvoices()],
        ['dues', () => financeApi.getDues()],
        ['pending', () => financeApi.getPendingPayments()],
        [
          'history',
          () =>
            financeApi.getPaymentHistory({ from: MONTH_START, to: MONTH_END }),
        ],
        [
          'receipts',
          () => financeApi.getReceipts({ from: MONTH_START, to: MONTH_END }),
        ],
        ['reconciliation', () => financeApi.getParentPaymentReconciliation()],
        [
          'report',
          () =>
            financeApi.getCollectionReport({
              from: MONTH_START,
              to: MONTH_END,
            }),
        ],
        ['charges', () => financeApi.getExtraCharges()],
        ['expenses', () => financeApi.getExpenses()],
        ['staff', () => financeApi.getPayrollStaff()],
        ['salaries', () => financeApi.getSalaries()],
      ];
      const results = await Promise.allSettled(
        entries.map(([, load]) => load()),
      );
      const setters = {
        workspace: setWorkspace,
        monthly: setMonthly,
        summary: setSummary,
        invoices: setInvoices,
        dues: setDues,
        pending: setPending,
        history: setHistory,
        receipts: setReceipts,
        reconciliation: setReconciliation,
        report: setReport,
        charges: setCharges,
        expenses: setExpenses,
        staff: setStaff,
        salaries: setSalaries,
      };
      const failures = [];
      results.forEach((result, index) => {
        const key = entries[index][0];
        if (result.status === 'fulfilled')
          setters[key](
            valueOf(result.value) ||
              (key === 'summary' || key === 'report' ? null : []),
          );
        else
          failures.push(result.reason?.message || `${key} could not be loaded`);
      });
      if (failures.length)
        setError(financeErrorMessage(new Error(failures[0])));
      setLoading(false);
    },
    [previewOnly],
  );

  useEffect(() => {
    loadData();
  }, [loadData]);
  useEffect(() => {
    setTab(initialTab(page));
  }, [page]);

  const duesByInvoice = useMemo(
    () => new Map(dues.map(item => [String(item.id), item])),
    [dues],
  );
  const q = invoiceQuery.trim().toLowerCase();
  const visibleInvoices = useMemo(
    () =>
      invoices.filter(invoice => {
        const due = duesByInvoice.get(String(invoice.id));
        const status = String(
          due?.status || invoice.status || '',
        ).toLowerCase();
        const isOverdue =
          due &&
          Number(due.balanceDue) > 0 &&
          invoice.dueDate &&
          String(invoice.dueDate).slice(0, 10) <
            new Date().toISOString().slice(0, 10);
        const matchesFilter =
          invoiceFilter === 'All' ||
          (invoiceFilter === 'Paid' && status === 'paid') ||
          (invoiceFilter === 'Partial' &&
            ['partial', 'partially_paid'].includes(status)) ||
          (invoiceFilter === 'Overdue' && isOverdue) ||
          (invoiceFilter === 'Unpaid' &&
            Number(due?.balanceDue ?? invoice.amount) > 0 &&
            !isOverdue);
        const searchable = `${invoice.id} ${invoice.student || ''} ${
          invoice.studentId || ''
        } ${invoice.description || ''} ${
          invoice.voucherCode || ''
        }`.toLowerCase();
        const matchesGrade =
          !gradeFilter.trim() ||
          String(invoice.grade ?? '').toLowerCase() ===
            gradeFilter.trim().toLowerCase();
        return matchesFilter && matchesGrade && (!q || searchable.includes(q));
      }),
    [invoices, duesByInvoice, invoiceFilter, gradeFilter, q],
  );

  const totals = useMemo(() => {
    const collected = Number(summary?.collected || 0);
    const outstanding = Number(summary?.outstanding || 0);
    const payrollPaid = salaries
      .filter(row => row.status === 'paid' && row.month === ACTIVE_MONTH)
      .reduce((sum, row) => sum + Number(row.netSalary || 0), 0);
    const expensesTotal = expenses
      .filter(row => String(row.expenseDate || '').startsWith(ACTIVE_MONTH))
      .reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const overdue = dues
      .filter(
        item =>
          Number(item.balanceDue) > 0 &&
          String(item.dueDate || '').slice(0, 10) <
            new Date().toISOString().slice(0, 10),
      )
      .reduce((sum, item) => sum + Number(item.balanceDue || 0), 0);
    return {
      collected,
      outstanding,
      payrollPaid,
      expensesTotal,
      overdue,
      net: collected - expensesTotal - payrollPaid,
    };
  }, [summary, salaries, expenses, dues]);
  const monthSalaries = useMemo(
    () =>
      salaries.filter(
        row => !salaryForm.month || row.month === salaryForm.month,
      ),
    [salaries, salaryForm.month],
  );

  async function run(action, successMessage, after = true) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await action();
      setNotice(successMessage || result?.message || 'Saved.');
      if (after) await loadData(true);
      return result;
    } catch (caught) {
      setError(financeErrorMessage(caught));
      return null;
    } finally {
      setBusy(false);
    }
  }
  async function searchStudents() {
    if (!studentQuery.trim()) {
      setStudentSearchResults([]);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await financeApi.searchStudents(studentQuery.trim());
      setStudentSearchResults(valueOf(result) || []);
    } catch (caught) {
      setError(financeErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  }
  async function createCharge() {
    const payload = {
      ...chargeForm,
      perStudentAmount: Number(chargeForm.perStudentAmount),
    };
    if (
      !payload.title.trim() ||
      !(payload.perStudentAmount > 0) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(payload.dueDate)
    ) {
      setError('Enter a title, valid amount, and due date before saving.');
      return;
    }
    const created = await run(
      () => financeApi.createExtraCharge(payload),
      'Extra charge saved as a draft. No invoices were created yet.',
    );
    if (created)
      setChargeForm({
        title: '',
        category: 'exam',
        perStudentAmount: '',
        dueDate: '',
        grade: 'all',
        description: '',
      });
  }
  function confirmApplyCharge(charge) {
    Alert.alert(
      'Apply extra charge?',
      `This will create one invoice for every active ${
        charge.grade === 'all'
          ? 'student in this campus'
          : `student in grade ${charge.grade}`
      }.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Create invoices',
          onPress: () =>
            run(
              () => financeApi.applyExtraCharge(charge.id),
              'Invoices were created for matching active students.',
            ),
        },
      ],
    );
  }
  async function createExpense() {
    const payload = { ...expenseForm, amount: Number(expenseForm.amount) };
    if (
      !payload.title.trim() ||
      !payload.vendor.trim() ||
      !(payload.amount > 0)
    ) {
      setError('Enter an expense name, vendor, and positive amount.');
      return;
    }
    const created = await run(
      () => financeApi.createExpense(payload, expenseBill),
      'Expense recorded in this campus ledger.',
    );
    if (created) {
      setExpenseForm(current => ({
        ...current,
        title: '',
        amount: '',
        vendor: '',
        notes: '',
      }));
      setExpenseBill(null);
    }
  }
  async function chooseBill() {
    try {
      const [file] = await pick({
        type: ['image/jpeg', 'image/png'],
        allowMultiSelection: false,
        mode: 'import',
      });
      if (file.size && file.size > 5 * 1024 * 1024) {
        setError('Choose a JPEG or PNG bill photo no larger than 5 MB.');
        return;
      }
      if (!file.name || !file.type) {
        setError('The selected bill needs a filename and file type.');
        return;
      }
      setExpenseBill({
        uri: file.uri,
        name: file.name,
        type: file.type,
        size: file.size,
      });
      setError('');
    } catch (pickerError) {
      if (!pickerError?.message?.toLowerCase().includes('cancel'))
        setError(pickerError.message || 'Could not open the document picker.');
    }
  }
  async function addSalary() {
    if (!salaryForm.staffUserId || !salaryForm.baseSalary) {
      setError('Select staff and enter base salary.');
      return;
    }
    const result = await run(
      () =>
        financeApi.createSalary({
          ...salaryForm,
          baseSalary: Number(salaryForm.baseSalary),
          deductions: Number(salaryForm.deductions || 0),
        }),
      'Salary draft saved.',
    );
    if (result)
      setSalaryForm(current => ({
        ...current,
        baseSalary: '',
        deductions: '0',
        deductionReason: '',
      }));
  }
  async function recordPayout(salary) {
    if (!payoutForm.reference.trim()) {
      setError(
        'Enter the actual bank/cash transaction reference. No money is moved by this action.',
      );
      return;
    }
    const result = await run(
      () =>
        financeApi.recordSalaryPayout(salary.id, {
          method: payoutForm.method,
          reference: payoutForm.reference.trim(),
          paidAt: new Date().toISOString(),
        }),
      'Payout recorded. This records a completed external payment; it does not transfer money.',
    );
    if (result) {
      setSelectedSalary('');
      setPayoutForm({ method: 'bank_transfer', reference: '' });
    }
  }
  async function openPayslip(salaryId) {
    if (previewOnly) return;
    const result = await run(() => financeApi.getPayslip(salaryId), '', false);
    if (result) {
      setPayslip(valueOf(result));
      setNotice('Payslip loaded.');
    }
  }
  async function openReceipt(paymentId) {
    if (previewOnly) return;
    const result = await run(() => financeApi.getReceipt(paymentId), '', false);
    if (result) {
      setReceiptDetails(valueOf(result));
      setNotice('Receipt details loaded from the Finance ledger.');
    }
  }
  async function verifyPayment(id) {
    const result = await run(() => financeApi.verifyPayment(id), '', true);
    if (result)
      setNotice(
        `Payment confirmed by Finance. Receipt ${
          valueOf(result)?.receiptNumber || 'issued'
        } is available in Receipts.`,
      );
  }
  function confirmPayment(item) {
    Alert.alert(
      'Approve this payment?',
      `Confirm that you checked the real proof for invoice ${
        item.invoiceId
      } and ${formatMoney(
        item.amount,
        item.currency,
      )}. The server will issue a receipt after validation.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Approve payment',
          onPress: () => {
            setWorkingId(String(item._id));
            verifyPayment(item._id).finally(() => setWorkingId(''));
          },
        },
      ],
    );
  }
  async function recordExistingPayment() {
    const invoiceId = paymentEntry.invoiceId.trim();
    const paidAmount = Number(paymentEntry.amount);
    const due = duesByInvoice.get(invoiceId);
    if (!invoiceId || !due) {
      setError('Choose an invoice from the campus balance list first.');
      return;
    }
    if (
      !Number.isFinite(paidAmount) ||
      paidAmount <= 0 ||
      Math.round(paidAmount * 100) !== paidAmount * 100
    ) {
      setError('Enter a positive amount with at most two decimal places.');
      return;
    }
    if (paidAmount > Number(due.availableBalance)) {
      setError(
        `Amount exceeds the available balance of ${formatMoney(
          due.availableBalance,
          due.currency,
        )}.`,
      );
      return;
    }
    const payload = {
      invoiceId,
      amount: paidAmount,
      method: paymentEntry.method,
      reference: paymentEntry.reference.trim(),
    };
    const fingerprint = JSON.stringify(payload);
    if (paymentKey.current.fingerprint !== fingerprint) {
      paymentKey.current = {
        fingerprint,
        value: `finance-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      };
    }
    const result = await run(
      () => financeApi.enterPayment(payload, paymentKey.current.value),
      'Payment entry saved as pending verification. No receipt has been issued.',
    );
    if (result) {
      setPaymentEntry({
        invoiceId: '',
        amount: '',
        method: 'cash',
        reference: '',
      });
      paymentKey.current = { fingerprint: '', value: '' };
    }
  }
  async function checkVoucher() {
    if (!voucherCode.trim()) {
      setError('Enter a voucher code.');
      return;
    }
    const result = await run(
      () => financeApi.verifyVoucher(voucherCode.trim()),
      '',
      false,
    );
    if (result) setVoucherResult(valueOf(result));
  }
  async function rejectPayment(id) {
    if (!rejectionReason.trim()) {
      setError('Add a rejection reason before rejecting this payment.');
      return;
    }
    const result = await run(
      () => financeApi.rejectPayment(id, rejectionReason.trim()),
      'Payment entry rejected; its reserved balance was released.',
    );
    if (result) setRejectionReason('');
  }
  async function applyInvoiceFilter(filter) {
    setInvoiceFilter(filter);
  }
  async function openBill(expense) {
    if (!expense.attachment) {
      setError('No bill attachment was uploaded for this expense.');
      return;
    }
    setViewingExpense(expense);
  }

  function Metric({ title, amount, tone = 'blue', hint }) {
    return (
      <Card style={styles.metricCard}>
        <View style={styles.metricTop}>
          <View
            style={[
              styles.metricDot,
              {
                backgroundColor:
                  tone === 'green'
                    ? C.green
                    : tone === 'amber'
                    ? C.amber
                    : tone === 'red'
                    ? C.red
                    : C.blue,
              },
            ]}
          />
          <Text style={styles.metricLabel}>{title}</Text>
        </View>
        <Text style={styles.metricAmount}>{amount}</Text>
        {hint ? <Text style={styles.metricHint}>{hint}</Text> : null}
      </Card>
    );
  }

  function Overview() {
    const maxMonthly = Math.max(
      ...monthly.flatMap(item => [
        Number(item.collected || 0),
        Number(item.expenses || 0) + Number(item.payroll || 0),
      ]),
      1,
    );
    return (
      <>
        <View style={styles.welcomeRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.eyebrow}>CAMPUS FINANCE</Text>
            <Text style={styles.pageTitle}>Finance overview</Text>
            <Text style={styles.pageSub}>
              Your branch ledger, payments and staff costs.
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={() => loadData()}
            style={styles.refreshButton}
          >
            <Text style={styles.refreshIcon}>↻</Text>
          </Pressable>
        </View>
        <Card style={styles.branchCard}>
          <View style={styles.branchMark}>
            <Text style={styles.branchMarkText}>H</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.branchKicker}>ACTIVE WORKSPACE</Text>
            <Text style={styles.branchTitle}>
              {workspace?.branch?.name || 'Assigned campus'}
            </Text>
            <Text style={styles.branchDesc}>
              {workspace?.branch?.code ? `${workspace.branch.code} · ` : ''}All
              figures are restricted to your Finance branch.
            </Text>
          </View>
          <Badge value="Live" />
        </Card>
        <View style={styles.metricGrid}>
          <Metric
            title="Collected this month"
            amount={formatMoney(totals.collected)}
            tone="green"
            hint="Confirmed receipts only"
          />
          <Metric
            title="Outstanding dues"
            amount={formatMoney(totals.outstanding)}
            tone="amber"
            hint={`${dues.length} invoice balances`}
          />
          <Metric
            title="Payroll this month"
            amount={formatMoney(totals.payrollPaid)}
            tone="blue"
            hint="Paid salary records"
          />
          <Metric
            title="Expenses this month"
            amount={formatMoney(totals.expensesTotal)}
            tone="red"
            hint={`Net after costs ${formatMoney(totals.net)}`}
          />
        </View>
        <Card style={styles.collectionCard}>
          <SectionTitle
            title="Monthly cashflow"
            detail="Collections compared with recorded expenses and payroll"
            right={<Text style={styles.chartCurrency}>6 months</Text>}
          />
          {monthly.length ? (
            <>
              {monthly.map(item => {
                const cost =
                  Number(item.expenses || 0) + Number(item.payroll || 0);
                return (
                  <View key={item.month} style={styles.barLine}>
                    <View style={styles.barLabelRow}>
                      <Text style={styles.barLabel}>
                        {new Date(
                          `${item.month}-01T00:00:00Z`,
                        ).toLocaleDateString(undefined, { month: 'short' })}
                      </Text>
                      <Text style={styles.barValue}>
                        In {formatMoney(item.collected)} · Out{' '}
                        {formatMoney(cost)}
                      </Text>
                    </View>
                    <View style={styles.barTrack}>
                      <View
                        style={[
                          styles.barFill,
                          {
                            width: `${Math.max(
                              item.collected ? 3 : 0,
                              (Number(item.collected || 0) / maxMonthly) * 100,
                            )}%`,
                          },
                        ]}
                      />
                    </View>
                    <View style={styles.barTrackCost}>
                      <View
                        style={[
                          styles.barFillCost,
                          {
                            width: `${Math.max(
                              cost ? 3 : 0,
                              (cost / maxMonthly) * 100,
                            )}%`,
                          },
                        ]}
                      />
                    </View>
                  </View>
                );
              })}
              <View style={styles.legendRow}>
                <Text style={styles.legendIncome}>● Collected</Text>
                <Text style={styles.legendCost}>● Expenses + payroll</Text>
              </View>
            </>
          ) : (
            <Text style={styles.muted}>
              No monthly finance activity is recorded yet.
            </Text>
          )}
        </Card>
        <SectionTitle
          title="Quick actions"
          detail="Common campus finance tasks"
        />
        <View style={styles.quickGrid}>
          <Quick
            title="Find student"
            subtitle="Fees & challans"
            icon="⌕"
            onPress={() => setTab('fees')}
          />
          <Quick
            title="Add extra charge"
            subtitle="Create campus invoices"
            icon="＋"
            onPress={() => setTab('charges')}
          />
          <Quick
            title="Verify payment"
            subtitle={`${pending.length} waiting`}
            icon="✓"
            onPress={() => setTab('review')}
          />
          <Quick
            title="Record expense"
            subtitle="Campus cost ledger"
            icon="↗"
            onPress={() => setTab('expenses')}
          />
        </View>
        <SectionTitle
          title="Needs attention"
          detail="Real records from this campus"
        />
        {pending.slice(0, 3).map(item => (
          <View key={String(item._id)}>{PaymentCard({ item })}</View>
        ))}
        {!pending.length && !loading ? (
          <Empty>No payment entries are waiting for verification.</Empty>
        ) : null}
      </>
    );
  }
  function Quick({ title, subtitle, icon, onPress }) {
    return (
      <Pressable
        accessibilityRole="button"
        onPress={onPress}
        style={styles.quickCard}
      >
        <Text style={styles.quickIcon}>{icon}</Text>
        <Text style={styles.quickTitle}>{title}</Text>
        <Text style={styles.quickSub}>{subtitle}</Text>
      </Pressable>
    );
  }
  function PaymentCard({ item }) {
    return (
      <Card>
        <View style={styles.rowBetween}>
          <Text style={styles.cardTitle}>Invoice {item.invoiceId}</Text>
          <Badge value={item.status} />
        </View>
        <Text style={styles.cardSub}>
          {item.student || item.studentId || 'Student'} ·{' '}
          {String(item.method || 'method').replaceAll('_', ' ')}
        </Text>
        <Text style={styles.moneyLarge}>
          {formatMoney(item.amount, item.currency)}
        </Text>
        <Text style={styles.cardSub}>
          {item.reference ? `Ref ${item.reference}` : 'Reference not supplied'}{' '}
          ·{' '}
          {item.createdAt
            ? new Date(item.createdAt).toLocaleDateString()
            : 'Date unavailable'}
        </Text>
        <Input
          label="Rejection note (required only to reject)"
          value={rejectionReason}
          onChangeText={setRejectionReason}
          placeholder="Explain why this receipt is rejected"
        />
        <View style={styles.actionRow}>
          <Button
            label={
              workingId === String(item._id)
                ? 'Working…'
                : 'Approve & issue receipt'
            }
            onPress={() => confirmPayment(item)}
            disabled={previewOnly || busy || !!workingId}
            tone="green"
            compact
          />
          <Button
            label="Reject"
            onPress={() => {
              setWorkingId(String(item._id));
              rejectPayment(item._id).finally(() => setWorkingId(''));
            }}
            disabled={previewOnly || busy || !rejectionReason.trim()}
            tone="red"
            compact
          />
        </View>
      </Card>
    );
  }

  function Fees() {
    return (
      <>
        <ScreenHeading
          eyebrow="RECEIVABLES"
          title="Fees & challans"
          detail="Find students, review balances and issue receipts."
        />
        <Input
          label="Student search"
          value={studentQuery}
          onChangeText={setStudentQuery}
          placeholder="Name, student ID, or invoice number"
        />
        <Button
          label="Search student records"
          onPress={searchStudents}
          disabled={previewOnly || busy || !studentQuery.trim()}
          compact
        />
        {studentSearchResults.map(student => (
          <Card key={student.id}>
            <View style={styles.rowBetween}>
              <View>
                <Text style={styles.cardTitle}>
                  {student.fullName || student.name || 'Student'}
                </Text>
                <Text style={styles.cardSub}>
                  {student.id} · {student.grade || 'Grade'}{' '}
                  {student.section || ''}
                </Text>
              </View>
              <Badge value="Campus" />
            </View>
          </Card>
        ))}
        <Input
          label="Search invoices"
          value={invoiceQuery}
          onChangeText={setInvoiceQuery}
          placeholder="Student, invoice, voucher"
        />
        <Input
          label="Class / grade filter"
          value={gradeFilter}
          onChangeText={setGradeFilter}
          placeholder="e.g. Grade 8"
          autoCapitalize="none"
        />
        <View style={styles.chipRow}>
          {['All', 'Paid', 'Unpaid', 'Overdue', 'Partial'].map(item => (
            <Chip
              key={item}
              label={item}
              selected={invoiceFilter === item}
              onPress={() => applyInvoiceFilter(item)}
            />
          ))}
        </View>
        <Card style={styles.summaryStrip}>
          <Text style={styles.summaryLabel}>CLASS/CAMPUS SUMMARY</Text>
          <Text style={styles.summaryText}>
            {summary?.invoiceCount ?? invoices.length} invoices ·{' '}
            {formatMoney(totals.collected)} collected
          </Text>
          <Text style={styles.summarySub}>
            {formatMoney(totals.outstanding)} currently outstanding
          </Text>
        </Card>
        <Card style={styles.infoCard}>
          <Text style={styles.infoTitle}>
            Record a payment already received
          </Text>
          <Text style={styles.infoText}>
            This creates a pending Finance entry for verification. It does not
            charge a card, move money, or issue a receipt. Card entries must
            refer to an external card payment already processed.
          </Text>
          <Text style={styles.inputLabel}>Choose an invoice with balance</Text>
          <View style={styles.chipRow}>
            {dues.slice(0, 20).map(item => (
              <Chip
                key={`entry-${item.id}`}
                label={`${
                  item.student || item.studentId || item.id
                } · ${formatMoney(item.availableBalance, item.currency)}`}
                selected={paymentEntry.invoiceId === String(item.id)}
                onPress={() =>
                  setPaymentEntry(current => ({
                    ...current,
                    invoiceId: String(item.id),
                  }))
                }
              />
            ))}
          </View>
          <Input
            label="Invoice ID"
            value={paymentEntry.invoiceId}
            onChangeText={value =>
              setPaymentEntry(current => ({ ...current, invoiceId: value }))
            }
            placeholder="Select above or enter invoice ID"
            autoCapitalize="none"
          />
          <Input
            label="Amount received (PKR)"
            value={paymentEntry.amount}
            onChangeText={value =>
              setPaymentEntry(current => ({ ...current, amount: value }))
            }
            placeholder="0.00"
            keyboardType="decimal-pad"
          />
          <Text style={styles.inputLabel}>Payment method</Text>
          <View style={styles.chipRow}>
            {METHODS.map(([key, label]) => (
              <Chip
                key={key}
                label={label}
                selected={paymentEntry.method === key}
                onPress={() =>
                  setPaymentEntry(current => ({ ...current, method: key }))
                }
              />
            ))}
          </View>
          <Input
            label="Reference (if available)"
            value={paymentEntry.reference}
            onChangeText={value =>
              setPaymentEntry(current => ({ ...current, reference: value }))
            }
            placeholder="Bank receipt / transaction reference"
            autoCapitalize="characters"
          />
          <Button
            label="Record for verification"
            onPress={recordExistingPayment}
            disabled={busy || previewOnly}
          />
        </Card>
        <Card>
          <SectionTitle
            title="Voucher verification"
            detail="Check an issued voucher without treating it as a paid receipt"
          />
          <Input
            label="Voucher code"
            value={voucherCode}
            onChangeText={setVoucherCode}
            placeholder="Enter printed voucher code"
            autoCapitalize="characters"
          />
          <Button
            label="Verify voucher"
            tone="secondary"
            compact
            onPress={checkVoucher}
            disabled={busy || previewOnly}
          />
          {voucherResult ? (
            <View style={styles.voucherResult}>
              <Text style={styles.cardTitle}>
                Voucher {voucherResult.voucherCode} ·{' '}
                {voucherResult.student || voucherResult.invoiceId}
              </Text>
              <Text style={styles.cardSub}>
                Invoice total{' '}
                {formatMoney(voucherResult.amount, voucherResult.currency)} ·
                Paid{' '}
                {formatMoney(voucherResult.paidAmount, voucherResult.currency)}{' '}
                · Pending{' '}
                {formatMoney(
                  voucherResult.pendingAmount,
                  voucherResult.currency,
                )}
              </Text>
              <Text style={styles.cardSub}>
                Due{' '}
                {formatMoney(voucherResult.balanceDue, voucherResult.currency)}{' '}
                · Available{' '}
                {formatMoney(
                  voucherResult.availableBalance,
                  voucherResult.currency,
                )}
              </Text>
              <Text style={styles.cardSub}>
                Voucher verification does not confirm payment.
              </Text>
            </View>
          ) : null}
        </Card>
        <SectionTitle
          title="Student invoices"
          detail={`${visibleInvoices.length} matching records`}
        />
        {visibleInvoices.map(invoice => {
          const due = duesByInvoice.get(String(invoice.id));
          const status = due?.status || invoice.status || 'issued';
          const late =
            due &&
            Number(due.balanceDue) > 0 &&
            String(invoice.dueDate || '').slice(0, 10) <
              new Date().toISOString().slice(0, 10);
          return (
            <Card key={String(invoice.id)}>
              <View style={styles.rowBetween}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>
                    {invoice.student || invoice.studentId || 'Student record'}
                  </Text>
                  <Text style={styles.cardSub}>
                    {invoice.studentId || 'Student ID unavailable'} · Grade{' '}
                    {invoice.grade || '—'} {invoice.section || ''} · Invoice{' '}
                    {invoice.id}
                  </Text>
                </View>
                <Badge value={late ? 'overdue' : status} />
              </View>
              <Text style={styles.invoiceAmount}>
                {formatMoney(invoice.amount, invoice.currency)}
              </Text>
              <Text style={styles.cardSub}>
                {invoice.description || 'School fee'} · Due{' '}
                {String(invoice.dueDate || '—').slice(0, 10)}
              </Text>
              <Text style={styles.cardSub}>
                Paid {formatMoney(due?.paidAmount, invoice.currency)} · Pending{' '}
                {formatMoney(due?.pendingAmount, invoice.currency)} · Balance{' '}
                {formatMoney(
                  due?.availableBalance ?? due?.balanceDue,
                  invoice.currency,
                )}
              </Text>
              {invoice.voucherCode ? (
                <Text style={styles.voucherLine}>
                  Voucher {invoice.voucherCode}
                </Text>
              ) : null}
              <Button
                label="Record payment for this invoice"
                tone="secondary"
                compact
                onPress={() =>
                  setPaymentEntry(current => ({
                    ...current,
                    invoiceId: String(invoice.id),
                    amount: '',
                  }))
                }
              />
            </Card>
          );
        })}
        {!visibleInvoices.length && !loading ? (
          <Empty>No invoice records match this filter.</Empty>
        ) : null}
        <SectionTitle
          title="Outstanding balance list"
          detail="Includes paid, pending and available amount"
        />
        {dues.slice(0, 25).map(item => (
          <Card key={`due-${item.id}`}>
            <View style={styles.rowBetween}>
              <Text style={styles.cardTitle}>
                {item.student || item.studentId || 'Student'} · {item.id}
              </Text>
              <Text style={styles.dueAmount}>
                {formatMoney(item.balanceDue, item.currency)}
              </Text>
            </View>
            <Text style={styles.cardSub}>
              Paid {formatMoney(item.paidAmount, item.currency)} · Pending{' '}
              {formatMoney(item.pendingAmount, item.currency)} · Available{' '}
              {formatMoney(item.availableBalance, item.currency)}
            </Text>
          </Card>
        ))}
      </>
    );
  }

  function Charges() {
    return (
      <>
        <ScreenHeading
          eyebrow="CAMPUS-WIDE BILLING"
          title="Generate invoices"
          detail="Create a tuition or extra charge once, then generate one invoice per matching student."
        />
        <Card style={styles.infoCard}>
          <Text style={styles.infoTitle}>
            No student is billed when you save a draft.
          </Text>
          <Text style={styles.infoText}>
            Review the scope and confirm Apply to create invoices
            transactionally. The server selects active students from your
            trusted campus branch.
          </Text>
        </Card>
        <Input
          label="Charge title"
          value={chargeForm.title}
          onChangeText={value =>
            setChargeForm(current => ({ ...current, title: value }))
          }
          placeholder="e.g. Annual science exhibition"
        />
        <Text style={styles.inputLabel}>Charge category</Text>
        <View style={styles.chipRow}>
          {CHARGE_CATEGORIES.map(([key, label]) => (
            <Chip
              key={key}
              label={label}
              selected={chargeForm.category === key}
              onPress={() =>
                setChargeForm(current => ({ ...current, category: key }))
              }
            />
          ))}
        </View>
        <Input
          label="Amount per student (PKR)"
          value={chargeForm.perStudentAmount}
          onChangeText={value =>
            setChargeForm(current => ({ ...current, perStudentAmount: value }))
          }
          placeholder="0.00"
          keyboardType="decimal-pad"
        />
        <Input
          label="Due date (YYYY-MM-DD)"
          value={chargeForm.dueDate}
          onChangeText={value =>
            setChargeForm(current => ({ ...current, dueDate: value }))
          }
          placeholder="2026-11-15"
          autoCapitalize="none"
        />
        <Input
          label="Grade scope (all or exact grade)"
          value={chargeForm.grade}
          onChangeText={value =>
            setChargeForm(current => ({ ...current, grade: value }))
          }
          placeholder="all"
          autoCapitalize="none"
        />
        <Input
          label="Notes"
          value={chargeForm.description}
          onChangeText={value =>
            setChargeForm(current => ({ ...current, description: value }))
          }
          placeholder="Why is this charge being collected?"
          multiline
        />
        <Button
          label={busy ? 'Saving…' : 'Save charge draft'}
          onPress={createCharge}
          disabled={busy || previewOnly}
        />
        <SectionTitle
          title="Charge batches"
          detail="Branch-scoped MongoDB records"
        />
        {charges.map(charge => (
          <Card key={charge.id}>
            <View style={styles.rowBetween}>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>{charge.title}</Text>
                <Text style={styles.cardSub}>
                  {charge.category} · Grade {charge.grade} · Due{' '}
                  {charge.dueDate}
                </Text>
              </View>
              <Badge value={charge.status} />
            </View>
            <Text style={styles.invoiceAmount}>
              {formatMoney(charge.perStudentAmount, charge.currency)}{' '}
              <Text style={styles.cardSub}>per student</Text>
            </Text>
            {charge.status === 'draft' ? (
              <Button
                label="Apply to matching students"
                onPress={() => confirmApplyCharge(charge)}
                disabled={busy || previewOnly}
                tone="primary"
              />
            ) : (
              <Text style={styles.cardSub}>
                {charge.invoiceCount || 0} invoices created ·{' '}
                {charge.appliedAt
                  ? new Date(charge.appliedAt).toLocaleString()
                  : ''}
              </Text>
            )}
          </Card>
        ))}
        {!charges.length && !loading ? (
          <Empty>
            No extra-charge batches have been created for this campus.
          </Empty>
        ) : null}
      </>
    );
  }

  function Review() {
    return (
      <>
        <ScreenHeading
          eyebrow="PAYMENT CONTROL"
          title="Payment verification"
          detail="Review Finance entries and reconcile parent checkout attempts."
        />
        <Card style={styles.infoCard}>
          <Text style={styles.infoTitle}>
            Approval creates a canonical payment receipt.
          </Text>
          <Text style={styles.infoText}>
            Only approve after checking the actual bank/cash proof. This screen
            never contacts a card gateway or marks an unverified payment
            successful.
          </Text>
        </Card>
        <SectionTitle
          title="Awaiting verification"
          detail={`${pending.length} records`}
        />
        {pending.map(item => (
          <View key={String(item._id)}>{PaymentCard({ item })}</View>
        ))}
        {!pending.length && !loading ? (
          <Empty>
            No payment entries are waiting for Finance verification.
          </Empty>
        ) : null}
        <SectionTitle
          title="Parent checkout reconciliation"
          detail="Gateway attempts that still require an authoritative status"
        />
        {reconciliation.map(item => (
          <Card key={String(item.paymentId)}>
            <View style={styles.rowBetween}>
              <Text style={styles.cardTitle}>
                Invoice {item.invoiceId || 'unavailable'}
              </Text>
              <Badge value={item.status} />
            </View>
            <Text style={styles.cardSub}>
              Student {item.studentId || 'unavailable'} ·{' '}
              {formatMoney(item.amount, item.currency)} ·{' '}
              {item.provider || 'Gateway'}
            </Text>
            <Text style={styles.cardSub}>
              Merchant status: {item.merchantStatus || 'unknown'} · Attempts{' '}
              {item.reconciliationAttempts || 0}
            </Text>
            <Text style={styles.infoText}>
              Reservation is retained until the server confirms a terminal
              outcome. This screen cannot manually mark it paid.
            </Text>
          </Card>
        ))}
        {!reconciliation.length && !loading ? (
          <Empty>No parent checkouts currently need reconciliation.</Empty>
        ) : null}
        <SectionTitle
          title="Confirmed payment history"
          detail="Recorded from server-confirmed transactions"
        />
        {history.slice(0, 30).map(item => (
          <Card key={String(item._id)}>
            <View style={styles.rowBetween}>
              <Text style={styles.cardTitle}>Invoice {item.invoiceId}</Text>
              <Badge value={item.status} />
            </View>
            <Text style={styles.invoiceAmount}>
              {formatMoney(item.amount, item.currency)}
            </Text>
            <Text style={styles.cardSub}>
              {String(item.method || '').replaceAll('_', ' ')} ·{' '}
              {item.receiptNumber || 'Receipt unavailable'} ·{' '}
              {item.confirmedAt
                ? new Date(item.confirmedAt).toLocaleDateString()
                : 'Date unavailable'}
            </Text>
          </Card>
        ))}
        {!history.length && !loading ? (
          <Empty>No confirmed payments are recorded yet.</Empty>
        ) : null}
      </>
    );
  }

  function Payroll() {
    const staffName = item =>
      item.fullName || item.name || item.email || String(item.id || item._id);
    return (
      <>
        <ScreenHeading
          eyebrow="STAFF COSTS"
          title="Payroll & salaries"
          detail="Draft, approve, and record salaries for staff in your assigned branch."
        />
        <Card style={styles.summaryStrip}>
          <Text style={styles.summaryLabel}>MONTHLY PAYROLL</Text>
          <Input
            label="Payroll month (YYYY-MM)"
            value={salaryForm.month}
            onChangeText={value =>
              setSalaryForm(current => ({ ...current, month: value }))
            }
            placeholder="2026-10"
            autoCapitalize="none"
          />
          <Text style={styles.summaryText}>
            {staff.length} active staff · {monthSalaries.length} salary records
            ·{' '}
            {formatMoney(
              monthSalaries
                .filter(row => row.status !== 'paid')
                .reduce((sum, row) => sum + Number(row.netSalary || 0), 0),
            )}{' '}
            still payable
          </Text>
        </Card>
        <SectionTitle
          title="Prepare salary"
          detail="Saves a draft only; does not transfer funds"
        />
        <Text style={styles.inputLabel}>Select staff member</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
        >
          {staff.map(member => {
            const id = String(member.id || member._id);
            return (
              <Chip
                key={id}
                label={staffName(member)}
                selected={salaryForm.staffUserId === id}
                onPress={() =>
                  setSalaryForm(current => ({ ...current, staffUserId: id }))
                }
              />
            );
          })}
        </ScrollView>
        {!staff.length && !loading ? (
          <Text style={styles.muted}>
            No active staff identities are available in this Finance branch.
          </Text>
        ) : null}
        <Input
          label="Base salary (PKR)"
          value={salaryForm.baseSalary}
          onChangeText={value =>
            setSalaryForm(current => ({ ...current, baseSalary: value }))
          }
          placeholder="0.00"
          keyboardType="decimal-pad"
        />
        <Input
          label="Deduction / advance (PKR)"
          value={salaryForm.deductions}
          onChangeText={value =>
            setSalaryForm(current => ({ ...current, deductions: value }))
          }
          placeholder="0.00"
          keyboardType="decimal-pad"
        />
        {Number(salaryForm.deductions) > 0 ? (
          <Input
            label="Deduction reason"
            value={salaryForm.deductionReason}
            onChangeText={value =>
              setSalaryForm(current => ({ ...current, deductionReason: value }))
            }
            placeholder="Reason required for deductions"
          />
        ) : null}
        <Button
          label="Save salary draft"
          onPress={addSalary}
          disabled={busy || previewOnly || !salaryForm.staffUserId}
        />
        <SectionTitle
          title="Staff salary records"
          detail="Review each member’s base, deduction and net payable"
        />
        {monthSalaries.map(salary => (
          <Card key={salary.id}>
            <View style={styles.rowBetween}>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>
                  {salary.staffName || salary.staffUserId}
                </Text>
                <Text style={styles.cardSub}>
                  {salary.month} · Base {formatMoney(salary.baseSalary)} ·
                  Deduction {formatMoney(salary.deductions)}
                </Text>
              </View>
              <Badge value={salary.status} />
            </View>
            <Text style={styles.invoiceAmount}>
              Net {formatMoney(salary.netSalary, salary.currency)}
            </Text>
            {salary.status === 'draft' ? (
              <Button
                label="Approve salary"
                onPress={() =>
                  run(
                    () => financeApi.approveSalary(salary.id),
                    'Salary approved.',
                  )
                }
                tone="secondary"
                compact
                disabled={busy || previewOnly}
              />
            ) : null}
            {salary.status === 'approved' ? (
              <>
                <Input
                  label={`Actual payout reference for ${
                    salary.staffName || 'staff'
                  }`}
                  value={
                    selectedSalary === salary.id ? payoutForm.reference : ''
                  }
                  onChangeText={value => {
                    setSelectedSalary(salary.id);
                    setPayoutForm(current => ({
                      ...current,
                      reference: value,
                    }));
                  }}
                  placeholder="Bank transfer/cash reference"
                  autoCapitalize="characters"
                />
                <View style={styles.chipRow}>
                  {METHODS.map(([key, label]) => (
                    <Chip
                      key={key}
                      label={label}
                      selected={payoutForm.method === key}
                      onPress={() => {
                        setSelectedSalary(salary.id);
                        setPayoutForm(current => ({ ...current, method: key }));
                      }}
                    />
                  ))}
                </View>
                <Button
                  label={busy ? 'Recording…' : 'Record completed payout'}
                  onPress={() => recordPayout(salary)}
                  disabled={busy || previewOnly || selectedSalary !== salary.id}
                />
              </>
            ) : null}
            {salary.status === 'paid' ? (
              <Button
                label="View payslip"
                onPress={() => openPayslip(salary.id)}
                tone="secondary"
                compact
                disabled={busy || previewOnly}
              />
            ) : null}
          </Card>
        ))}
        {!monthSalaries.length && !loading ? (
          <Empty>No salary records exist for this month and campus.</Empty>
        ) : null}
        {payslip ? (
          <Card style={styles.payslip}>
            <Text style={styles.cardTitle}>Payslip · {payslip.staffName}</Text>
            <Text style={styles.cardSub}>
              {payslip.month} · {payslip.status}
            </Text>
            <Text style={styles.cardSub}>
              Base {formatMoney(payslip.baseSalary)} − Deduction{' '}
              {formatMoney(payslip.deductions)} = Net{' '}
              {formatMoney(payslip.netSalary)}
            </Text>
            <Text style={styles.cardSub}>
              Payout ref {payslip.payout?.reference || '—'}
            </Text>
          </Card>
        ) : null}
      </>
    );
  }

  function Expenses() {
    const categoryTotals = EXPENSE_CATEGORIES.map(([key, label]) => ({
      key,
      label,
      total: expenses
        .filter(item => item.category === key)
        .reduce((sum, item) => sum + Number(item.amount || 0), 0),
    })).filter(item => item.total > 0);
    const categoryMax = Math.max(...categoryTotals.map(item => item.total), 1);
    return (
      <>
        <ScreenHeading
          eyebrow="CAMPUS SPENDING"
          title="Expenses & petty cash"
          detail="Record operating costs with a bill attachment saved in MongoDB."
        />
        <Card style={styles.infoCard}>
          <Text style={styles.infoTitle}>
            Expense records are branch scoped.
          </Text>
          <Text style={styles.infoText}>
            Adding a record logs the expense. It does not initiate a bank or
            wallet payment.
          </Text>
        </Card>
        <Input
          label="Expense title"
          value={expenseForm.title}
          onChangeText={value =>
            setExpenseForm(current => ({ ...current, title: value }))
          }
          placeholder="e.g. Classroom stationery"
        />
        <Text style={styles.inputLabel}>Category</Text>
        <View style={styles.chipRow}>
          {EXPENSE_CATEGORIES.map(([key, label]) => (
            <Chip
              key={key}
              label={label}
              selected={expenseForm.category === key}
              onPress={() =>
                setExpenseForm(current => ({ ...current, category: key }))
              }
            />
          ))}
        </View>
        <Input
          label="Amount (PKR)"
          value={expenseForm.amount}
          onChangeText={value =>
            setExpenseForm(current => ({ ...current, amount: value }))
          }
          placeholder="0.00"
          keyboardType="decimal-pad"
        />
        <Input
          label="Vendor"
          value={expenseForm.vendor}
          onChangeText={value =>
            setExpenseForm(current => ({ ...current, vendor: value }))
          }
          placeholder="Vendor or payee"
        />
        <Input
          label="Expense date (YYYY-MM-DD)"
          value={expenseForm.expenseDate}
          onChangeText={value =>
            setExpenseForm(current => ({ ...current, expenseDate: value }))
          }
          placeholder="2026-10-18"
          autoCapitalize="none"
        />
        <Text style={styles.inputLabel}>Payment mode</Text>
        <View style={styles.chipRow}>
          {METHODS.map(([key, label]) => (
            <Chip
              key={key}
              label={label}
              selected={expenseForm.method === key}
              onPress={() =>
                setExpenseForm(current => ({ ...current, method: key }))
              }
            />
          ))}
        </View>
        <Input
          label="Notes"
          value={expenseForm.notes}
          onChangeText={value =>
            setExpenseForm(current => ({ ...current, notes: value }))
          }
          placeholder="Optional details"
          multiline
        />
        <Button
          label={
            expenseBill
              ? `Bill: ${expenseBill.name}`
              : 'Attach bill photo (JPEG/PNG)'
          }
          onPress={chooseBill}
          tone="secondary"
          compact
          disabled={previewOnly}
        />
        {expenseBill ? (
          <Button
            label="Remove attachment"
            onPress={() => setExpenseBill(null)}
            tone="secondary"
            compact
          />
        ) : null}
        <Button
          label={busy ? 'Saving…' : 'Save expense record'}
          onPress={createExpense}
          disabled={busy || previewOnly}
        />
        <SectionTitle
          title="Spending by category"
          detail="Totals from expense records in this campus"
        />
        <Card>
          {categoryTotals.length ? (
            categoryTotals.map(item => (
              <View key={item.key} style={styles.barLine}>
                <View style={styles.barLabelRow}>
                  <Text style={styles.barLabel}>{item.label}</Text>
                  <Text style={styles.barValue}>{formatMoney(item.total)}</Text>
                </View>
                <View style={styles.barTrack}>
                  <View
                    style={[
                      styles.barFillCost,
                      {
                        width: `${Math.max(
                          3,
                          (item.total / categoryMax) * 100,
                        )}%`,
                      },
                    ]}
                  />
                </View>
              </View>
            ))
          ) : (
            <Text style={styles.muted}>
              Expense category chart appears after records are added.
            </Text>
          )}
        </Card>
        <SectionTitle
          title="Expense ledger"
          detail={`${expenses.length} branch records`}
        />
        {expenses.map(expense => (
          <Card key={expense.id}>
            <View style={styles.rowBetween}>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>{expense.title}</Text>
                <Text style={styles.cardSub}>
                  {expense.category.replaceAll('_', ' ')} · {expense.vendor}
                </Text>
              </View>
              <Text style={styles.dueAmount}>
                {formatMoney(expense.amount, expense.currency)}
              </Text>
            </View>
            <Text style={styles.cardSub}>
              {expense.expenseDate} ·{' '}
              {String(expense.method).replaceAll('_', ' ')} · recorded
            </Text>
            {expense.attachment ? (
              <Button
                label={`View bill: ${expense.attachment.fileName}`}
                onPress={() => openBill(expense)}
                tone="secondary"
                compact
              />
            ) : null}
          </Card>
        ))}
        {!expenses.length && !loading ? (
          <Empty>No expenses have been recorded for this campus.</Empty>
        ) : null}
      </>
    );
  }

  function Reports() {
    const currencies = report?.confirmedCollections || [];
    return (
      <>
        <ScreenHeading
          eyebrow="RECONCILIATION"
          title="Finance reports"
          detail="Numbers are derived from confirmed payments, invoices, payroll and expenses."
        />
        <View style={styles.metricGrid}>
          <Metric
            title="Confirmed collections"
            amount={formatMoney(totals.collected)}
            tone="green"
          />
          <Metric
            title="Outstanding receivables"
            amount={formatMoney(totals.outstanding)}
            tone="amber"
          />
          <Metric
            title="Overdue balance"
            amount={formatMoney(totals.overdue)}
            tone="red"
          />
          <Metric
            title="Recorded expenses"
            amount={formatMoney(totals.expensesTotal)}
            tone="blue"
          />
        </View>
        <Card>
          <SectionTitle
            title="Collections by currency"
            detail="Finance payments only when confirmed"
          />
          {currencies.length ? (
            currencies.map(row => (
              <View key={row._id || 'currency'} style={styles.reportRow}>
                <Text style={styles.reportLabel}>
                  {row._id || 'PKR'} · {row.count} payments
                </Text>
                <Text style={styles.reportValue}>
                  {formatMoney(row.total, row._id || 'PKR')}
                </Text>
              </View>
            ))
          ) : (
            <Text style={styles.muted}>
              No confirmed collections in this period.
            </Text>
          )}
        </Card>
        <Card>
          <SectionTitle
            title="Collections by method"
            detail="From the branch collection report"
          />
          {(report?.byMethod || []).length ? (
            report.byMethod.map(row => (
              <View key={`${row._id}-${row.currency}`} style={styles.reportRow}>
                <Text style={styles.reportLabel}>
                  {String(row._id || 'Other').replaceAll('_', ' ')} ·{' '}
                  {row.count}
                </Text>
                <Text style={styles.reportValue}>
                  {formatMoney(row.total, row.currency)}
                </Text>
              </View>
            ))
          ) : (
            <Text style={styles.muted}>
              Method breakdown appears after confirmed payments.
            </Text>
          )}
        </Card>
        <Card>
          <SectionTitle
            title="Six-month cashflow"
            detail="Collected, expenses and payroll from MongoDB"
          />
          {monthly.map(row => (
            <View key={row.month} style={styles.reportRow}>
              <Text style={styles.reportLabel}>{row.month}</Text>
              <Text style={styles.reportValue}>
                In {formatMoney(row.collected)} · Costs{' '}
                {formatMoney(
                  Number(row.expenses || 0) + Number(row.payroll || 0),
                )}
              </Text>
            </View>
          ))}
        </Card>
        <Card style={styles.infoCard}>
          <Text style={styles.infoTitle}>
            Payroll and expenses are operational records.
          </Text>
          <Text style={styles.infoText}>
            Payroll is counted after recorded payout. Expenses reflect entries
            saved by Finance; they are not bank-statement imports.
          </Text>
        </Card>
      </>
    );
  }

  function Receipts() {
    return (
      <>
        <ScreenHeading
          eyebrow="CONFIRMED PAYMENTS"
          title="Receipts"
          detail="Receipt records are issued only after the backend confirms a payment."
        />
        {receipts.map(receipt => (
          <Card key={String(receipt._id || receipt.id)}>
            <View style={styles.rowBetween}>
              <Text style={styles.cardTitle}>
                {receipt.receiptNumber || 'Receipt'}
              </Text>
              <Badge value="confirmed" />
            </View>
            <Text style={styles.invoiceAmount}>
              {formatMoney(receipt.amount, receipt.currency)}
            </Text>
            <Text style={styles.cardSub}>
              {receipt.student || receipt.studentId || 'Student'} · invoice{' '}
              {receipt.invoiceId}
            </Text>
            <Text style={styles.cardSub}>
              {String(receipt.method || '').replaceAll('_', ' ')} ·{' '}
              {receipt.confirmedAt
                ? new Date(receipt.confirmedAt).toLocaleDateString()
                : 'Date unavailable'}
            </Text>
            <Button
              label="View receipt details"
              tone="secondary"
              compact
              onPress={() => openReceipt(String(receipt._id || receipt.id))}
              disabled={busy || previewOnly}
            />
          </Card>
        ))}
        {!receipts.length && !loading ? (
          <Empty>No confirmed receipts were found for this month.</Empty>
        ) : null}
        {receiptDetails ? (
          <Card style={styles.payslip}>
            <Text style={styles.cardTitle}>
              {receiptDetails.receiptNumber || 'Receipt details'}
            </Text>
            <Text style={styles.cardSub}>
              {receiptDetails.student || 'Student'} · Invoice{' '}
              {receiptDetails.invoiceId}
            </Text>
            <Text style={styles.cardSub}>
              {receiptDetails.description || 'School fee'} ·{' '}
              {formatMoney(receiptDetails.amount, receiptDetails.currency)}
            </Text>
            <Text style={styles.cardSub}>
              Method {String(receiptDetails.method || '').replaceAll('_', ' ')}{' '}
              · Reference {receiptDetails.reference || '—'}
            </Text>
            <Text style={styles.cardSub}>
              Confirmed{' '}
              {receiptDetails.confirmedAt
                ? new Date(receiptDetails.confirmedAt).toLocaleString()
                : '—'}
            </Text>
          </Card>
        ) : null}
      </>
    );
  }

  function ScreenHeading({ eyebrow, title, detail }) {
    return (
      <View style={styles.screenHeading}>
        <Text style={styles.eyebrow}>{eyebrow}</Text>
        <Text style={styles.pageTitle}>{title}</Text>
        <Text style={styles.pageSub}>{detail}</Text>
      </View>
    );
  }

  const current = TABS.find(item => item.id === tab) || TABS[0];
  return (
    <KeyboardAvoidingView
      style={styles.keyboard}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        style={styles.page}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <View style={styles.headerBrand}>
            <View style={styles.brandMark}>
              <Text style={styles.brandText}>H</Text>
            </View>
            <View>
              <Text style={styles.eyebrow}>SCHOOL FINANCE</Text>
              <Text style={styles.headerTitle}>Campus workspace</Text>
            </View>
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={() => loadData()}
            style={styles.refreshButton}
          >
            <Text style={styles.refreshIcon}>↻</Text>
          </Pressable>
        </View>
        <View style={styles.tabScrollWrap}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.tabRow}
          >
            {TABS.map(item => (
              <Pressable
                key={item.id}
                accessibilityRole="tab"
                accessibilityState={{ selected: tab === item.id }}
                onPress={() => {
                  setTab(item.id);
                  setError('');
                  setNotice('');
                }}
                style={[styles.tab, tab === item.id && styles.tabActive]}
              >
                <Text
                  style={[
                    styles.tabIcon,
                    tab === item.id && styles.tabIconActive,
                  ]}
                >
                  {item.icon}
                </Text>
                <Text
                  style={[
                    styles.tabText,
                    tab === item.id && styles.tabTextActive,
                  ]}
                >
                  {item.label}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
        <View style={styles.breadcrumb}>
          <Text style={styles.breadcrumbText}>Finance</Text>
          <Text style={styles.breadcrumbSep}>›</Text>
          <Text style={styles.breadcrumbActive}>{current.label}</Text>
        </View>
        {previewOnly ? (
          <View style={styles.previewNotice}>
            <Text style={styles.previewNoticeText}>
              DEVELOPMENT PREVIEW · Sample records only · Actions are disabled
            </Text>
          </View>
        ) : null}
        {error ? (
          <View accessibilityRole="alert" style={styles.errorBanner}>
            <Text style={styles.errorTitle}>Could not finish that request</Text>
            <Text style={styles.errorText}>{error}</Text>
            <Button
              label="Retry data load"
              onPress={() => loadData()}
              tone="secondary"
              compact
            />
          </View>
        ) : null}
        {notice ? (
          <View accessibilityRole="alert" style={styles.noticeBanner}>
            <Text style={styles.noticeText}>{notice}</Text>
          </View>
        ) : null}
        {loading ? (
          <View style={styles.loading}>
            <ActivityIndicator color={C.blue} />
            <Text style={styles.muted}>Loading branch finance records…</Text>
          </View>
        ) : null}
        {tab === 'overview' ? Overview() : null}
        {tab === 'fees' ? Fees() : null}
        {tab === 'charges' ? Charges() : null}
        {tab === 'review' ? Review() : null}
        {tab === 'receipts' ? Receipts() : null}
        {tab === 'payroll' ? Payroll() : null}
        {tab === 'expenses' ? Expenses() : null}
        {tab === 'reports' ? Reports() : null}
        <View style={styles.footer}>
          <Text style={styles.footerText}>
            Branch-scoped · role-protected · MongoDB-backed
          </Text>
          <Text style={styles.gatewayNote}>
            Parent card checkout stays disabled until a real gateway is
            configured.
          </Text>
        </View>
      </ScrollView>
      <Modal
        visible={!!viewingExpense}
        transparent
        animationType="fade"
        onRequestClose={() => setViewingExpense(null)}
      >
        <View style={styles.modalShade}>
          <View style={styles.attachmentModal}>
            <View style={styles.rowBetween}>
              <Text style={styles.cardTitle}>
                {viewingExpense?.title || 'Expense bill'}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close bill preview"
                onPress={() => setViewingExpense(null)}
                style={styles.modalClose}
              >
                <Text style={styles.modalCloseText}>×</Text>
              </Pressable>
            </View>
            <Text style={styles.cardSub}>
              {viewingExpense?.attachment?.fileName} ·{' '}
              {formatMoney(viewingExpense?.amount, viewingExpense?.currency)}
            </Text>
            {viewingExpense?.attachment ? (
              <Image
                resizeMode="contain"
                style={styles.attachmentImage}
                source={{
                  uri: `${API_ROOT}/finance/expenses/${encodeURIComponent(
                    viewingExpense.id,
                  )}/attachment`,
                  headers: getAuthHeaders(),
                }}
                onError={() =>
                  setError(
                    'Could not load this bill image. Check your API connection and branch access.',
                  )
                }
              />
            ) : null}
            <Button
              label="Close"
              onPress={() => setViewingExpense(null)}
              tone="secondary"
            />
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  keyboard: { flex: 1, backgroundColor: C.bg },
  page: { flex: 1, backgroundColor: C.bg },
  content: { paddingHorizontal: 18, paddingTop: 10, paddingBottom: 42 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 15,
  },
  headerBrand: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  brandMark: {
    width: 46,
    height: 46,
    borderRadius: 15,
    backgroundColor: C.blue,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandText: { color: C.white, fontSize: 25, fontWeight: '900' },
  headerTitle: { color: C.ink, fontSize: 17, fontWeight: '900', marginTop: 2 },
  eyebrow: {
    color: C.muted,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.5,
  },
  refreshButton: {
    width: 43,
    height: 43,
    borderRadius: 15,
    backgroundColor: C.lavender,
    alignItems: 'center',
    justifyContent: 'center',
  },
  refreshIcon: { color: C.blue, fontSize: 25, fontWeight: '700' },
  tabScrollWrap: { marginHorizontal: -18, paddingHorizontal: 18 },
  tabRow: { flexDirection: 'row', gap: 8, paddingBottom: 10 },
  tab: {
    minHeight: 43,
    borderRadius: 14,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: C.paper,
    borderWidth: 1,
    borderColor: C.line,
  },
  tabActive: { backgroundColor: C.blue, borderColor: C.blue },
  tabIcon: { color: C.blue, fontWeight: '900', fontSize: 15 },
  tabIconActive: { color: C.white },
  tabText: { color: C.ink, fontWeight: '700', fontSize: 11 },
  tabTextActive: { color: C.white },
  breadcrumb: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 13,
  },
  breadcrumbText: { color: C.muted, fontSize: 11, fontWeight: '700' },
  breadcrumbSep: { color: C.muted, fontSize: 16 },
  breadcrumbActive: { color: C.blue, fontSize: 11, fontWeight: '900' },
  welcomeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  pageTitle: {
    color: C.ink,
    fontSize: 27,
    fontWeight: '900',
    letterSpacing: -0.5,
    marginTop: 5,
  },
  pageSub: { color: C.muted, fontSize: 13, lineHeight: 19, marginTop: 5 },
  screenHeading: { marginTop: 2, marginBottom: 17 },
  branchCard: {
    marginTop: 17,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
  },
  branchMark: {
    width: 48,
    height: 48,
    borderRadius: 15,
    backgroundColor: C.gold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  branchMarkText: { color: C.blue, fontSize: 23, fontWeight: '900' },
  branchKicker: {
    color: C.muted,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1,
  },
  branchTitle: { color: C.ink, fontSize: 14, fontWeight: '900', marginTop: 3 },
  branchDesc: { color: C.muted, fontSize: 10, lineHeight: 15, marginTop: 3 },
  metricGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 11,
  },
  metricCard: { width: '48%', flexGrow: 1, minHeight: 112, padding: 13 },
  metricTop: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  metricDot: { width: 8, height: 8, borderRadius: 4 },
  metricLabel: { color: C.muted, fontSize: 10, fontWeight: '800', flex: 1 },
  metricAmount: {
    color: C.ink,
    fontSize: 18,
    fontWeight: '900',
    marginTop: 12,
  },
  metricHint: { color: C.muted, fontSize: 9, marginTop: 4 },
  card: {
    backgroundColor: C.paper,
    borderRadius: 19,
    borderColor: C.line,
    borderWidth: 1,
    padding: 15,
    marginTop: 11,
    shadowColor: '#514B3B',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  collectionCard: { marginTop: 18 },
  sectionHeader: {
    marginTop: 22,
    marginBottom: 7,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionHeadingBox: { flex: 1 },
  sectionTitle: { color: C.ink, fontSize: 17, fontWeight: '900' },
  sectionDetail: { color: C.muted, fontSize: 11, lineHeight: 16, marginTop: 3 },
  chartCurrency: {
    color: C.blue,
    fontSize: 10,
    fontWeight: '900',
    backgroundColor: C.lavender,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 9,
  },
  barLine: { marginTop: 12 },
  barLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  barLabel: {
    color: C.ink,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'capitalize',
  },
  barValue: { color: C.muted, fontSize: 10, fontWeight: '700' },
  barTrack: {
    height: 8,
    borderRadius: 8,
    backgroundColor: C.lavender,
    overflow: 'hidden',
  },
  barFill: { height: 8, borderRadius: 8, backgroundColor: C.green },
  barTrackCost: {
    height: 8,
    borderRadius: 8,
    backgroundColor: C.redBg,
    overflow: 'hidden',
    marginTop: 4,
  },
  barFillCost: { height: 8, borderRadius: 8, backgroundColor: C.red },
  legendRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
    marginTop: 14,
  },
  legendIncome: { color: C.green, fontSize: 9, fontWeight: '800' },
  legendCost: { color: C.red, fontSize: 9, fontWeight: '800' },
  quickGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  quickCard: {
    width: '48%',
    flexGrow: 1,
    borderRadius: 17,
    padding: 13,
    backgroundColor: C.paper,
    borderColor: C.line,
    borderWidth: 1,
  },
  quickIcon: { color: C.blue, fontSize: 22, fontWeight: '900' },
  quickTitle: { color: C.ink, fontSize: 12, fontWeight: '900', marginTop: 8 },
  quickSub: { color: C.muted, fontSize: 10, marginTop: 3 },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  actionRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  inputWrap: { marginTop: 12 },
  inputLabel: {
    color: C.muted,
    fontSize: 10,
    fontWeight: '800',
    marginBottom: 5,
  },
  input: {
    backgroundColor: C.paper,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 13,
    minHeight: 45,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: C.ink,
    fontSize: 13,
  },
  inputMultiline: { minHeight: 75, textAlignVertical: 'top' },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 7,
    marginTop: 8,
    marginBottom: 5,
  },
  chip: {
    backgroundColor: C.paper,
    borderColor: C.line,
    borderWidth: 1,
    borderRadius: 13,
    paddingHorizontal: 11,
    paddingVertical: 8,
  },
  chipSelected: { backgroundColor: C.lavender, borderColor: C.blue },
  chipGreen: { backgroundColor: C.greenBg, borderColor: '#B9E2CB' },
  chipText: {
    color: C.ink,
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'capitalize',
  },
  chipTextSelected: { color: C.blue },
  button: {
    minHeight: 45,
    borderRadius: 13,
    backgroundColor: C.blue,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },
  buttonCompact: { minHeight: 38, paddingHorizontal: 11, marginTop: 9 },
  button_primary: { backgroundColor: C.blue },
  button_secondary: { backgroundColor: C.lavender },
  button_green: {
    backgroundColor: C.greenBg,
    borderWidth: 1,
    borderColor: '#B9E2CB',
    flex: 1,
  },
  button_red: {
    backgroundColor: C.redBg,
    borderWidth: 1,
    borderColor: '#F3C7C1',
    flex: 1,
  },
  buttonText: {
    color: C.white,
    fontSize: 11,
    fontWeight: '900',
    textAlign: 'center',
  },
  buttonText_secondary: { color: C.blue },
  buttonText_green: { color: C.green },
  buttonText_red: { color: C.red },
  disabled: { opacity: 0.48 },
  badge: {
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 9,
    alignSelf: 'flex-start',
  },
  badge_green: { backgroundColor: C.greenBg },
  badge_amber: { backgroundColor: C.amberBg },
  badge_red: { backgroundColor: C.redBg },
  badge_blue: { backgroundColor: C.lavender },
  badgeText: { fontSize: 9, fontWeight: '900', textTransform: 'capitalize' },
  badgeText_green: { color: C.green },
  badgeText_amber: { color: C.amber },
  badgeText_red: { color: C.red },
  badgeText_blue: { color: C.blue },
  cardTitle: { color: C.ink, fontSize: 13, fontWeight: '900', flexShrink: 1 },
  cardSub: { color: C.muted, fontSize: 10, lineHeight: 15, marginTop: 5 },
  moneyLarge: { color: C.ink, fontSize: 21, fontWeight: '900', marginTop: 10 },
  invoiceAmount: {
    color: C.blue,
    fontSize: 17,
    fontWeight: '900',
    marginTop: 12,
  },
  dueAmount: { color: C.red, fontSize: 14, fontWeight: '900' },
  voucherLine: { color: C.blue, fontSize: 10, fontWeight: '800', marginTop: 6 },
  summaryStrip: { backgroundColor: C.lavender },
  summaryLabel: {
    color: C.blue,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1,
  },
  summaryText: { color: C.ink, fontSize: 14, fontWeight: '900', marginTop: 7 },
  summarySub: { color: C.muted, fontSize: 10, marginTop: 4 },
  infoCard: { backgroundColor: C.sky, borderColor: '#CFE4F0' },
  infoTitle: { color: C.ink, fontSize: 12, fontWeight: '900' },
  infoText: { color: C.muted, fontSize: 10, lineHeight: 16, marginTop: 5 },
  previewNotice: {
    backgroundColor: C.amberBg,
    borderRadius: 12,
    padding: 10,
    marginBottom: 12,
  },
  previewNoticeText: {
    color: C.amber,
    fontSize: 9,
    fontWeight: '900',
    textAlign: 'center',
  },
  empty: {
    minHeight: 88,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: C.paper,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 17,
    marginTop: 10,
  },
  emptyIcon: { color: C.blue, fontSize: 20 },
  emptyText: {
    color: C.muted,
    fontSize: 11,
    textAlign: 'center',
    marginTop: 5,
    lineHeight: 17,
  },
  loading: {
    flexDirection: 'row',
    gap: 9,
    alignItems: 'center',
    paddingVertical: 12,
  },
  muted: { color: C.muted, fontSize: 11, lineHeight: 17 },
  noticeBanner: {
    backgroundColor: C.greenBg,
    borderRadius: 13,
    padding: 11,
    marginVertical: 8,
  },
  noticeText: {
    color: C.green,
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 17,
  },
  errorBanner: {
    backgroundColor: C.redBg,
    borderRadius: 14,
    padding: 12,
    marginVertical: 8,
  },
  errorTitle: { color: C.red, fontSize: 12, fontWeight: '900' },
  errorText: { color: C.red, fontSize: 10, lineHeight: 16, marginTop: 4 },
  reportRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: C.line,
    paddingVertical: 10,
  },
  reportLabel: { color: C.ink, fontSize: 11, textTransform: 'capitalize' },
  reportValue: { color: C.ink, fontSize: 11, fontWeight: '900' },
  payslip: { borderColor: C.blue, borderWidth: 1 },
  footer: { paddingTop: 27, alignItems: 'center' },
  footerText: { color: C.muted, fontSize: 9, fontWeight: '700' },
  gatewayNote: {
    color: C.muted,
    fontSize: 9,
    lineHeight: 14,
    textAlign: 'center',
    marginTop: 5,
  },
  modalShade: {
    flex: 1,
    backgroundColor: 'rgba(27,29,48,0.65)',
    justifyContent: 'center',
    padding: 18,
  },
  attachmentModal: {
    maxHeight: '85%',
    backgroundColor: C.paper,
    borderRadius: 22,
    padding: 15,
  },
  modalClose: {
    width: 34,
    height: 34,
    borderRadius: 12,
    backgroundColor: C.lavender,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCloseText: { color: C.blue, fontSize: 23, fontWeight: '800' },
  attachmentImage: {
    width: '100%',
    height: 420,
    marginTop: 12,
    backgroundColor: C.bg,
    borderRadius: 14,
  },
});
