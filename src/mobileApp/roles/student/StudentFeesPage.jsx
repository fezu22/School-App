import PageIcon from '../../shared/components/PageIcon';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { studentApi } from './studentService';
import { studentPreview } from '../../shared/data/previewData';

const asRows = value => {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.invoices)) return value.invoices;
  if (Array.isArray(value?.fees)) return value.fees;
  if (Array.isArray(value?.data)) return value.data;
  return [];
};
const amount = value => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
const money = (value, currency = 'PKR') =>
  `${currency} ${amount(value).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
const dateLabel = value => {
  if (!value) return 'Due date not set';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Due date not set';
  return `Due ${date.toLocaleDateString(undefined, {
    day: 'numeric', month: 'short', year: 'numeric',
  })}`;
};
function invoiceAmounts(invoice) {
  const total = amount(invoice.amount ?? invoice.totalAmount);
  const paid = amount(invoice.confirmedPaidAmount ?? invoice.paidAmount);
  const pending = amount(invoice.pendingAmount);
  const outstanding = amount(invoice.balanceDue ?? Math.max(total - paid, 0));
  const payable = amount(
    invoice.availableBalance ?? Math.max(outstanding - pending, 0),
  );
  return { total, paid, pending, outstanding, payable };
}
function invoiceStatus(invoice, values) {
  const raw = String(invoice.status || '').toLowerCase().replace(/[_-]/g, ' ');
  if (values.outstanding <= 0 || raw === 'paid') return 'Paid';
  if (raw === 'overdue' && values.payable > 0) return 'Overdue';
  if (values.pending > 0 && values.payable <= 0) return 'Payment in review';
  if (values.pending > 0) return 'Partly in review';
  if (values.paid > 0) return 'Partially paid';
  return 'Due';
}

function FeeStat({ label, value, tone }) {
  return (
    <View style={[styles.stat, tone && { backgroundColor: tone }]}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text numberOfLines={1} adjustsFontSizeToFit style={styles.statValue}>{value}</Text>
    </View>
  );
}

function InvoiceCard({ invoice }) {
  const values = invoiceAmounts(invoice);
  const currency = invoice.currency || 'PKR';
  const status = invoiceStatus(invoice, values);
  const statusTone = status === 'Paid'
    ? styles.paidStatus
    : status === 'Overdue'
    ? styles.overdueStatus
    : status.includes('review')
    ? styles.reviewStatus
    : styles.dueStatus;
  const fields = [
    ['Invoice total', money(values.total, currency)],
    ['Confirmed paid', money(values.paid, currency)],
    ['Pending review', money(values.pending, currency)],
    ['Outstanding', money(values.outstanding, currency)],
  ];
  return (
    <View style={styles.invoice}>
      <View style={styles.invoiceTop}>
        <View style={styles.invoiceIcon}><PageIcon name="receipt" size={22} /></View>
        <View style={styles.invoiceHeading}>
          <Text style={styles.invoiceTitle}>{invoice.description || invoice.invoiceNumber || invoice.id || 'School fee'}</Text>
          <Text style={styles.invoiceMeta}>
            {[invoice.invoiceNumber && `Invoice ${invoice.invoiceNumber}`, dateLabel(invoice.dueDate)]
              .filter(Boolean).join(' · ')}
          </Text>
        </View>
        <View style={[styles.statusBadge, statusTone]}>
          <Text style={styles.statusText}>{status}</Text>
        </View>
      </View>
      <View style={styles.invoiceDivider} />
      <View style={styles.breakdown}>
        {fields.map(([label, value]) => (
          <View key={label} style={styles.breakdownItem}>
            <Text style={styles.breakdownLabel}>{label}</Text>
            <Text numberOfLines={1} adjustsFontSizeToFit style={styles.breakdownValue}>{value}</Text>
          </View>
        ))}
      </View>
      <View style={styles.payableRow}>
        <View style={styles.payableCopy}>
          <Text style={styles.payableLabel}>Available to pay</Text>
          <Text style={styles.payableHint}>
            {values.pending > 0
              ? 'Pending payments are not counted as paid yet.'
              : 'Only confirmed payments reduce your balance.'}
          </Text>
        </View>
        <Text style={styles.payableValue}>{money(values.payable, currency)}</Text>
      </View>
    </View>
  );
}

export default function StudentFeesPage({ previewOnly = false, onNavigate }) {
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(!previewOnly);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = previewOnly
        ? studentPreview.fees || []
        : await studentApi.getFees();
      setInvoices(asRows(data));
    } catch (failure) {
      setInvoices([]);
      setError(failure?.message || 'Fees could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [previewOnly]);
  useEffect(() => { load(); }, [load, refreshKey]);
  const totalsByCurrency = useMemo(() => {
    const totals = new Map();
    invoices.forEach(invoice => {
      const currency = invoice.currency || 'PKR';
      const item = invoiceAmounts(invoice);
      const total = totals.get(currency) || { paid: 0, pending: 0, payable: 0 };
      total.paid += item.paid;
      total.pending += item.pending;
      total.payable += item.payable;
      totals.set(currency, total);
    });
    return [...totals.entries()];
  }, [invoices]);

  return (
    <ScrollView
      style={styles.page}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={loading} onRefresh={() => setRefreshKey(key => key + 1)} tintColor="#535ABB" />
      }
    >
      <View style={styles.header}>
        <View style={styles.headerIcon}><PageIcon name="receipt" size={29} /></View>
        <Text style={styles.eyebrow}>STUDENT ACCOUNT</Text>
        <Text style={styles.title}>Fees & payments</Text>
        <Text style={styles.subtitle}>A clear view of invoices, confirmed payments, and what is still payable.</Text>
      </View>
      {error ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorTitle}>Fee details did not load</Text>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable accessibilityRole="button" onPress={load} style={styles.retryButton}>
            <Text style={styles.retryText}>Try again</Text>
          </Pressable>
        </View>
      ) : null}
      {loading && !invoices.length ? <ActivityIndicator style={styles.loading} color="#535ABB" /> : null}
      {!loading && !error && invoices.length ? (
        <>
          {totalsByCurrency.map(([currency, total]) => (
            <View key={currency} style={styles.summaryCard}>
              <View style={styles.summaryHeading}>
                <View>
                  <Text style={styles.summaryEyebrow}>FEE SUMMARY</Text>
                  <Text style={styles.summaryTitle}>{currency} account</Text>
                </View>
                <View style={styles.summaryIcon}><PageIcon name="wallet" size={22} /></View>
              </View>
              <View style={styles.stats}>
                <FeeStat label="Payable now" value={money(total.payable, currency)} tone="#FFF0D7" />
                <FeeStat label="Payment in review" value={money(total.pending, currency)} tone="#EEEFFF" />
                <FeeStat label="Confirmed paid" value={money(total.paid, currency)} tone="#E7F4EA" />
              </View>
            </View>
          ))}
          <View style={styles.listHeading}>
            <Text style={styles.listTitle}>Your invoices</Text>
            <Text style={styles.invoiceCount}>{invoices.length} {invoices.length === 1 ? 'invoice' : 'invoices'}</Text>
          </View>
          {invoices.map((invoice, index) => (
            <InvoiceCard key={invoice.id || invoice._id || index} invoice={invoice} />
          ))}
          <View style={styles.helpNote}>
            <PageIcon name="help" size={18} />
            <Text style={styles.helpText}>If a payment is still under review, ask your parent or guardian to contact the school before paying it again.</Text>
          </View>
        </>
      ) : null}
      {!loading && !error && !invoices.length ? (
        <View style={styles.empty}>
          <View style={styles.emptyIcon}><PageIcon name="receipt" size={28} /></View>
          <Text style={styles.emptyTitle}>No fee invoices yet</Text>
          <Text style={styles.emptyText}>When your school issues an invoice, it will appear here with payment updates.</Text>
        </View>
      ) : null}
      {previewOnly ? <Text style={styles.preview}>Design preview · local sample records</Text> : null}
      <Pressable accessibilityRole="button" onPress={() => onNavigate?.('Home')} style={styles.backButton}>
        <Text style={styles.backText}>Back to Overview</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#F7F7FC' },
  content: { paddingHorizontal: 18, paddingTop: 20, paddingBottom: 35 },
  header: { padding: 21, borderRadius: 24, backgroundColor: '#363B7C', marginBottom: 17, overflow: 'hidden' },
  headerIcon: { width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF1F', marginBottom: 16 },
  eyebrow: { color: '#C9CDFE', fontSize: 9, fontWeight: '900', letterSpacing: 1.6 },
  title: { color: '#FFFFFF', fontSize: 25, lineHeight: 31, fontWeight: '900', marginTop: 6 },
  subtitle: { color: '#E0E1F5', fontSize: 12, lineHeight: 19, marginTop: 7 },
  summaryCard: { backgroundColor: '#FFFFFF', borderRadius: 21, borderWidth: 1, borderColor: '#E8E8F1', padding: 15, marginBottom: 18 },
  summaryHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 13 },
  summaryEyebrow: { color: '#8A8DA6', fontSize: 8, fontWeight: '900', letterSpacing: 1.4 },
  summaryTitle: { color: '#30345F', fontSize: 16, fontWeight: '900', marginTop: 4 },
  summaryIcon: { width: 38, height: 38, borderRadius: 13, backgroundColor: '#EEEFFF', alignItems: 'center', justifyContent: 'center' },
  stats: { gap: 8 },
  stat: { minHeight: 51, paddingHorizontal: 12, borderRadius: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  statLabel: { color: '#676A84', fontSize: 11, fontWeight: '700', flex: 1 },
  statValue: { color: '#30345F', fontSize: 13, fontWeight: '900' },
  listHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 11, marginTop: 2 },
  listTitle: { color: '#292D59', fontSize: 18, fontWeight: '900' },
  invoiceCount: { color: '#82849A', fontSize: 11, fontWeight: '700' },
  invoice: { backgroundColor: '#FFFFFF', borderRadius: 20, borderWidth: 1, borderColor: '#E8E8F1', padding: 15, marginBottom: 12 },
  invoiceTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  invoiceIcon: { width: 42, height: 42, borderRadius: 14, backgroundColor: '#EEEFFF', alignItems: 'center', justifyContent: 'center' },
  invoiceHeading: { flex: 1, minWidth: 0 },
  invoiceTitle: { color: '#30345F', fontSize: 14, fontWeight: '900' },
  invoiceMeta: { color: '#85879B', fontSize: 10, marginTop: 5 },
  statusBadge: { borderRadius: 20, paddingHorizontal: 9, paddingVertical: 6, maxWidth: 111 },
  statusText: { color: '#4F557E', fontSize: 9, fontWeight: '900' },
  paidStatus: { backgroundColor: '#E6F4EA' },
  overdueStatus: { backgroundColor: '#FDE9E7' },
  reviewStatus: { backgroundColor: '#EEEFFF' },
  dueStatus: { backgroundColor: '#FFF0D7' },
  invoiceDivider: { height: 1, backgroundColor: '#F0F0F5', marginVertical: 14 },
  breakdown: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 14 },
  breakdownItem: { width: '50%', paddingRight: 8 },
  breakdownLabel: { color: '#85879B', fontSize: 9, fontWeight: '700' },
  breakdownValue: { color: '#383C66', fontSize: 12, fontWeight: '900', marginTop: 5 },
  payableRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, backgroundColor: '#F5F5FF', borderRadius: 14, padding: 12, marginTop: 15 },
  payableCopy: { flex: 1 },
  payableLabel: { color: '#454A9C', fontSize: 11, fontWeight: '900' },
  payableHint: { color: '#777B95', fontSize: 9, lineHeight: 14, marginTop: 4 },
  payableValue: { color: '#34397F', fontSize: 13, fontWeight: '900' },
  helpNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, padding: 13, borderRadius: 15, backgroundColor: '#FFF2D9', marginTop: 2 },
  helpText: { color: '#76633B', fontSize: 10, lineHeight: 16, flex: 1 },
  errorBox: { padding: 16, borderRadius: 17, backgroundColor: '#FDEBE9' },
  errorTitle: { color: '#A13B42', fontSize: 14, fontWeight: '900' },
  errorText: { color: '#8E5556', fontSize: 12, lineHeight: 18, marginTop: 6 },
  retryButton: { alignSelf: 'flex-start', marginTop: 9, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 12, backgroundColor: '#FFFFFF' },
  retryText: { color: '#5157B7', fontSize: 11, fontWeight: '900' },
  loading: { marginVertical: 24 },
  empty: { alignItems: 'center', padding: 24, backgroundColor: '#FFFFFF', borderRadius: 20, borderWidth: 1, borderColor: '#E8E8F1' },
  emptyIcon: { width: 60, height: 60, borderRadius: 20, backgroundColor: '#EEEFFF', alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { color: '#30345F', fontSize: 16, fontWeight: '900', marginTop: 14 },
  emptyText: { color: '#85879B', fontSize: 12, lineHeight: 19, textAlign: 'center', marginTop: 6 },
  preview: { color: '#85879B', fontSize: 10, textAlign: 'center', marginTop: 18 },
  backButton: { alignItems: 'center', justifyContent: 'center', minHeight: 46, borderRadius: 15, borderWidth: 1, borderColor: '#E5E5EF', backgroundColor: '#FFFFFF', marginTop: 16 },
  backText: { color: '#535ABB', fontSize: 12, fontWeight: '800' },
});
