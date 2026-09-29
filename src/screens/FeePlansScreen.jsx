import React, { useCallback, useState } from 'react';
import { Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Page, Card, Title, Muted, Field, Button, Choice, ErrorText, Busy } from '../components/UI';

const money = amount => `PKR ${(Number(amount || 0) / 100).toLocaleString()}`;
const frequencies = ['ONE_TIME', 'MONTHLY', 'QUARTERLY', 'ANNUAL'].map(value => ({ value, label: value }));
export default function FeePlansScreen() {
  const { user } = useAuth();
  const [items, setItems] = useState([]), [busy, setBusy] = useState(false), [loading, setLoading] = useState(false), [error, setError] = useState('');
  const [branchId, setBranchId] = useState(''), [name, setName] = useState(''), [category, setCategory] = useState('Tuition'), [amount, setAmount] = useState(''), [frequency, setFrequency] = useState('MONTHLY'), [dueDay, setDueDay] = useState('1');
  const load = useCallback(async () => { setLoading(true); try { setItems((await api('/fee-plans')).items); } catch (e) { setError(e.message); } finally { setLoading(false); } }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  const create = async () => {
    try {
      const paisa = Math.round(Number(amount) * 100);
      if (!branchId || !name.trim() || !Number.isSafeInteger(paisa) || paisa < 1) throw Error('Enter branch, plan name and a valid amount');
      setBusy(true); await api('/fee-plans', 'POST', { branchId: branchId.trim(), name: name.trim(), category: category.trim(), frequency, amount: paisa, dueDay: Number(dueDay) || 1 });
      setName(''); setAmount(''); setError(''); await load(); Alert.alert('Saved', 'Fee plan created.');
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const generate = plan => Alert.prompt('Generate invoices', 'Enter period key and due date (YYYY-MM-DD)', async value => {
    const [periodKey, dueDate] = String(value || '').split(',').map(v => v.trim());
    if (!periodKey || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate || '')) return setError('Use: 2026-10,2026-10-10');
    try { setBusy(true); const r = await api(`/fee-plans/${plan._id}/generate`, 'POST', { periodKey, dueDate }); Alert.alert('Generated', `${r.created} invoice(s) created; ${r.skipped} already existed.`); } catch (e) { setError(e.message); } finally { setBusy(false); }
  }, 'plain-text', '', 'Generate');
  if (!['SUPER_ADMIN', 'ACCOUNTANT'].includes(user.role)) return <Page><Card><Title>Fee plans</Title><Muted>Fee plans are managed by the Super Admin or Accountant.</Muted></Card></Page>;
  return <Page><Title>Fee plans</Title><Muted>Plans create durable student/category/period invoices. Existing cash closing remains a separate partial control.</Muted><ErrorText message={error} />
    <Card><Title>Create plan</Title><Field label="Branch ID" value={branchId} onChangeText={setBranchId} /><Field label="Plan name" value={name} onChangeText={setName} /><Field label="Category" value={category} onChangeText={setCategory} /><Field label="Amount (PKR)" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" /><Choice label="Frequency" value={frequency} onChange={setFrequency} options={frequencies} /><Field label="Due day (1-28)" value={dueDay} onChangeText={setDueDay} keyboardType="number-pad" /><Button title="Create fee plan" onPress={create} busy={busy} /></Card>
    {loading && <Busy />}{items.map(plan => <Card key={plan._id}><Title>{plan.name}</Title><Muted>{plan.category} · {plan.frequency} · {money(plan.amount)} · Branch {plan.branchId?.name || plan.branchId?._id || plan.branchId}</Muted><Button title="Generate invoices" onPress={() => generate(plan)} busy={busy} /></Card>)}
  </Page>;
}
