import React, { useCallback, useState } from 'react';
import { Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Page, Card, Title, Muted, Field, Choice, Button, ErrorText, Empty, Busy } from '../components/UI';
const money = amount => `PKR ${(amount / 100).toLocaleString()}`;
export default function CashClosingScreen() {
  const { user } = useAuth();
  const [branches, setBranches] = useState([]);
  const [branchId, setBranchId] = useState('');
  const [items, setItems] = useState([]);
  const [counted, setCounted] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [entryKind, setEntryKind] = useState('EXPENSE'), [entryAmount, setEntryAmount] = useState(''), [entryDescription, setEntryDescription] = useState('');
  const [varianceExplanation, setVarianceExplanation] = useState('');
  const load = useCallback(async () => {
    try {
      const [b, c] = await Promise.all([api('/branches'), api('/invoices/cash-closings')]);
      setBranches(b.items); setItems(c.items);
      setBranchId(previous => previous || b.items[0]?._id || '');
      setError('');
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  const close = () => {
    const amount = Math.round(Number(counted) * 100);
    if (!counted || !Number.isSafeInteger(amount) || amount < 0) return setError('Enter the cash physically counted in PKR');
    Alert.alert('Close cash for today?', 'This records the variance and blocks further cash entries for this branch today.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Confirm', onPress: async () => {
        setBusy(true);
        try {
          await api('/invoices/cash-closings', 'POST', { branchId, countedAmount: amount, varianceExplanation });
          setCounted(''); await load();
          Alert.alert('Cash closed', 'The counted amount and variance were recorded.');
        } catch (e) { setError(e.message); }
        finally { setBusy(false); }
      } },
    ]);
  };
  const recordEntry = async () => {
    const amount = Math.round(Number(entryAmount) * 100);
    if (!entryDescription.trim() || !Number.isSafeInteger(amount) || amount < 0 || (entryKind !== 'OPENING' && amount === 0)) return setError('Enter a description and valid amount');
    try { setBusy(true); await api('/invoices/cash-entries', 'POST', { branchId, kind: entryKind, amount, description: entryDescription.trim(), requestKey: `${Date.now()}-${entryKind}` }); setEntryAmount(''); setEntryDescription(''); await load(); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const approve = async item => { try { setBusy(true); await api(`/invoices/cash-closings/${item._id}/approve`, 'POST', {}); await load(); } catch (e) { setError(e.message); } finally { setBusy(false); } };
  const handover = item => Alert.prompt('Cash handover', 'Enter recipient Accountant user ID, then note separated by comma', async value => { const [recipientId, note] = String(value || '').split(',').map(v => v.trim()); if (!recipientId || !note) return setError('Recipient ID and handover note are required'); try { setBusy(true); await api(`/invoices/cash-closings/${item._id}/handover`, 'POST', { recipientId, note }); await load(); } catch (e) { setError(e.message); } finally { setBusy(false); } }, 'plain-text', '', 'Record');
  const today = new Date().toISOString().slice(0, 10);
  const closed = items.some(item => String(item.branchId?._id || item.branchId) === branchId && item.date === today);
  return <Page>
    <Title>Cash closing</Title>
    <Muted>Cash recorded today is compared with the physical count. Date uses UTC.</Muted>
    <ErrorText message={error} />
    {loading ? <Busy /> : <>
      {branches.length ? <Card>
        <Choice label="Branch" value={branchId} onChange={setBranchId} options={branches.map(b => ({ value: b._id, label: b.name }))} />
        {closed ? <Muted>Cash is already closed for this branch today.</Muted> : <>
          {['SUPER_ADMIN', 'ACCOUNTANT'].includes(user.role) && <>
            <Choice label="Cash entry" value={entryKind} onChange={setEntryKind} options={['OPENING', 'EXPENSE', 'TRANSFER_IN', 'TRANSFER_OUT'].map(value => ({ value, label: value }))} />
            <Field label="Entry amount (PKR)" keyboardType="decimal-pad" value={entryAmount} onChangeText={setEntryAmount} />
            <Field label="Entry description" value={entryDescription} onChangeText={setEntryDescription} />
            <Button title="Record cash entry" secondary onPress={recordEntry} busy={busy} />
          </>}
          <Field label="Physical cash counted (PKR)" keyboardType="decimal-pad" value={counted} onChangeText={setCounted} />
          <Field label="Variance explanation (required when different)" value={varianceExplanation} onChangeText={setVarianceExplanation} />
          <Button title="Close today's cash" onPress={close} busy={busy} />
        </>}
      </Card> : <Empty text="No assigned branch is available." />}
      <Title>Closing history</Title>
      {items.length ? items.map(item => <Card key={item._id}>
        <Title>{item.branchId?.name || 'Branch'} · {item.date}</Title>
        <Muted>Opening {money(item.openingAmount)} · Expected {money(item.expectedAmount)} · Counted {money(item.countedAmount)}{'\n'}Difference {money(item.difference)} · Expenses {money(item.expensesAmount)} · Transfers {money(item.transfersInAmount)} in / {money(item.transfersOutAmount)} out{'\n'}{item.varianceExplanation || 'No variance'} · {item.approvedAt ? `Approved · ${item.handoverAt ? 'Handed over' : 'Handover pending'}` : 'Approval pending'}</Muted>
        {['SUPER_ADMIN', 'PRINCIPAL'].includes(user.role) && !item.approvedAt && <Button title="Approve closing" secondary onPress={() => approve(item)} busy={busy} />}
        {['SUPER_ADMIN', 'PRINCIPAL'].includes(user.role) && item.approvedAt && !item.handoverAt && <Button title="Record cashier handover" secondary onPress={() => handover(item)} busy={busy} />}
      </Card>) : <Empty text="No cash closings recorded." />}
      <Button title="Refresh" secondary onPress={load} />
    </>}
  </Page>;
}
