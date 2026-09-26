import React, { useCallback, useState } from 'react';
import { Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Page, Card, Title, Muted, Field, Button, Choice, ErrorText, Busy } from '../components/UI';
const money = amount => `PKR ${(Number(amount || 0) / 100).toLocaleString()}`;
const key = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const toPaisa = value => {
  const result = Math.round(Number(value) * 100);
  if (!value || !Number.isSafeInteger(result) || result <= 0) throw Error('Enter a positive PKR amount');
  return result;
};
const methods = ['CASH', 'BANK', 'CHEQUE'].map(v => ({ value: v, label: v }));
export default function InvoiceDetailScreen({ route }) {
  const id = route.params.invoice._id;
  const { user } = useAuth();
  const [invoice, setInvoice] = useState(route.params.invoice);
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(false), [error, setError] = useState('');
  const [amount, setAmount] = useState(''), [method, setMethod] = useState('CASH'), [reference, setReference] = useState('');
  const [requestKey, setRequestKey] = useState(key);
  const [discount, setDiscount] = useState(String((invoice.discountAmount || 0) / 100)), [discountReason, setDiscountReason] = useState(invoice.discountReason || '');
  const [refundPaymentId, setRefundPaymentId] = useState(''), [refundAmount, setRefundAmount] = useState(''), [refundMethod, setRefundMethod] = useState('BANK'), [refundReason, setRefundReason] = useState(''), [refundReference, setRefundReference] = useState('');
  const [refundKey, setRefundKey] = useState(key);
  const canPay = ['SUPER_ADMIN', 'ACCOUNTANT'].includes(user.role);
  const canApprove = user.role === 'SUPER_ADMIN';
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api('/invoices');
      const item = data.items.find(entry => entry._id === id);
      if (!item) throw Error('Invoice is no longer accessible');
      setInvoice(item); setError('');
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  const confirm = (title, description, operation) => Alert.alert(title, description, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Confirm', onPress: async () => {
      setBusy(true); setError('');
      try { await operation(); await load(); Alert.alert('Saved', 'The fee ledger has been updated.'); }
      catch (e) { setError(e.message); }
      finally { setBusy(false); }
    } },
  ]);
  const pay = () => {
    let value; try { value = toPaisa(amount); } catch (e) { return setError(e.message); }
    confirm('Record payment?', `${money(value)} · ${method}`, async () => {
      await api(`/invoices/${id}/payments`, 'POST', { amount: value, method, reference, requestKey });
      setRequestKey(key()); setAmount(''); setReference('');
    });
  };
  const approveDiscount = () => {
    const value = Math.round(Number(discount) * 100);
    if (!Number.isSafeInteger(value) || value < 0) return setError('Enter a valid concession');
    if (value > 0 && !discountReason.trim()) return setError('Enter a concession reason');
    confirm('Approve concession?', `${money(value)} will reduce this invoice.`, async () => {
      await api(`/invoices/${id}/concession`, 'PUT', { amount: value, reason: discountReason });
    });
  };
  const refund = () => {
    let value; try { value = toPaisa(refundAmount); } catch (e) { return setError(e.message); }
    if (!refundPaymentId || refundReason.trim().length < 3) return setError('Select the original payment and enter a refund reason');
    confirm('Record refund?', `${money(value)} credit will be refunded by ${refundMethod}.`, async () => {
      await api(`/invoices/${id}/refunds`, 'POST', { paymentId: refundPaymentId, amount: value, method: refundMethod, reason: refundReason.trim(), reference: refundReference, requestKey: refundKey });
      setRefundKey(key()); setRefundAmount(''); setRefundReason(''); setRefundReference('');
    });
  };
  return <Page>
    <Title>{invoice.title}</Title><Muted>{invoice.studentId?.name} · Due {invoice.dueDate}</Muted>
    <ErrorText message={error} />
    {loading && <Busy />}
    <Card><Title>{money(invoice.balance)} due</Title>
      <Muted>Original {money(invoice.amount)} · Concession {money(invoice.discountAmount)}{'\n'}Net charge {money(invoice.netCharge ?? invoice.amount - (invoice.discountAmount || 0))} · Net paid {money(invoice.paid)}{'\n'}Credit available for refund {money(invoice.credit)}</Muted>
      {!!invoice.discountReason && <Muted>Concession reason: {invoice.discountReason}</Muted>}
    </Card>
    {canApprove && <Card><Title>Concession</Title>
      <Muted>Only the Super Admin can approve an invoice concession. Credit from a previously paid invoice can be refunded below.</Muted>
      <Field label="Total concession (PKR)" value={discount} onChangeText={setDiscount} keyboardType="decimal-pad" />
      <Field label="Reason" value={discountReason} onChangeText={setDiscountReason} />
      <Button title="Approve concession" onPress={approveDiscount} busy={busy} />
    </Card>}
    {canPay && invoice.balance > 0 && <Card><Title>Record payment</Title>
      <Field label="Amount (PKR)" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
      <Choice label="Method" value={method} onChange={setMethod} options={methods} />
      <Field label="Reference / cheque number" value={reference} onChangeText={setReference} />
      <Button title="Record payment" onPress={pay} busy={busy} />
    </Card>}
    {canApprove && invoice.credit > 0 && <Card><Title>Refund available credit</Title>
      <Choice label="Original payment" value={refundPaymentId} onChange={setRefundPaymentId} options={(invoice.payments || []).map(p => ({ value: p._id, label: `${money(p.amount)} · ${p.method} · ${p._id.slice(-6)}` }))} />
      <Field label="Refund amount (PKR)" value={refundAmount} onChangeText={setRefundAmount} keyboardType="decimal-pad" />
      <Choice label="Refund method" value={refundMethod} onChange={setRefundMethod} options={methods} />
      <Field label="Refund reason" value={refundReason} onChangeText={setRefundReason} />
      <Field label="Refund reference" value={refundReference} onChangeText={setRefundReference} />
      <Button title="Record refund" onPress={refund} busy={busy} />
    </Card>}
    <Title>Receipts</Title>
    {(invoice.payments || []).map(p => <Card key={p._id}><Title>{money(p.amount)}</Title><Muted>{p.method} · {new Date(p.createdAt).toLocaleString()}{'\n'}Receipt ID: {p._id}{'\n'}{p.reference}</Muted></Card>)}
    <Title>Refund history</Title>
    {(invoice.refunds || []).map(r => <Card key={r._id}><Title>{money(r.amount)}</Title><Muted>{r.method} · {new Date(r.createdAt).toLocaleString()}{'\n'}Original receipt: {r.paymentId}{'\n'}{r.reason} · {r.reference}</Muted></Card>)}
    <Button title="Refresh" secondary onPress={load} busy={loading} />
  </Page>;
}
