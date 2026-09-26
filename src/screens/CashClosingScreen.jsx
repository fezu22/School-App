import React, { useCallback, useState } from 'react';
import { Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { api } from '../api/client';
import { Page, Card, Title, Muted, Field, Choice, Button, ErrorText, Empty, Busy } from '../components/UI';
const money = amount => `PKR ${(amount / 100).toLocaleString()}`;
export default function CashClosingScreen() {
  const [branches, setBranches] = useState([]);
  const [branchId, setBranchId] = useState('');
  const [items, setItems] = useState([]);
  const [counted, setCounted] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
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
          await api('/invoices/cash-closings', 'POST', { branchId, countedAmount: amount });
          setCounted(''); await load();
          Alert.alert('Cash closed', 'The counted amount and variance were recorded.');
        } catch (e) { setError(e.message); }
        finally { setBusy(false); }
      } },
    ]);
  };
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
          <Field label="Physical cash counted (PKR)" keyboardType="decimal-pad" value={counted} onChangeText={setCounted} />
          <Button title="Close today's cash" onPress={close} busy={busy} />
        </>}
      </Card> : <Empty text="No assigned branch is available." />}
      <Title>Closing history</Title>
      {items.length ? items.map(item => <Card key={item._id}>
        <Title>{item.branchId?.name || 'Branch'} · {item.date}</Title>
        <Muted>Expected {money(item.expectedAmount)} · Counted {money(item.countedAmount)}{'\n'}Difference {money(item.difference)} · {item.paymentsCount} cash payments · {item.refundsCount} cash refunds</Muted>
      </Card>) : <Empty text="No cash closings recorded." />}
      <Button title="Refresh" secondary onPress={load} />
    </>}
  </Page>;
}
