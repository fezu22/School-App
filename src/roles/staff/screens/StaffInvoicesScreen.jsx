import React, { useState } from 'react';
import { RefreshControl } from 'react-native';
import { api } from '../../../api/client';
import { useAuth } from '../../../auth/AuthContext';
import { useList } from '../../../api/useList';
import { Page, Card, Title, Label, Muted, Field, Button, Choice, ErrorText, Empty, Busy } from '../../../components/UI';

export default function StaffInvoicesScreen({ navigation }) {
  const { user } = useAuth();
  const canCreate = user.role === 'SUPER_ADMIN'; // principal is view-only
  const { items, loading, error, setError, load } = useList('/staff/invoices');
  const [adding, setAdding] = useState(false),
    [students, setStudents] = useState([]),
    [form, setForm] = useState({}),
    [busy, setBusy] = useState(false);
  const update = (k, v) => setForm(f => ({ ...f, [k]: v }));
  async function openForm() {
    setBusy(true);
    try {
      setStudents((await api('/staff/students')).items);
      setAdding(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    setBusy(true);
    setError('');
    try {
      const amount = Number(form.amount);
      if (!Number.isFinite(amount)) throw Error('Enter a valid amount');
      await api('/staff/invoices', 'POST', {
        studentId: form.studentId,
        title: form.title,
        dueDate: form.dueDate,
        amount: Math.round(amount * 100),
      });
      setAdding(false);
      setForm({});
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Page refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
      <Title>Fees & receipts</Title>
      <ErrorText message={error} />
      {canCreate && <Button title={adding ? 'Cancel' : 'Add invoice'} onPress={() => (adding ? setAdding(false) : openForm())} busy={busy && !adding} />}
      {adding && (
        <Card>
          <Field label="Fee description" value={form.title || ''} onChangeText={v => update('title', v)} />
          <Field label="Amount in PKR" value={form.amount || ''} onChangeText={v => update('amount', v)} keyboardType="decimal-pad" />
          <Field label="Due date (YYYY-MM-DD)" value={form.dueDate || ''} onChangeText={v => update('dueDate', v)} />
          <Choice
            label="Student"
            value={form.studentId}
            options={students.map(s => ({ value: s._id, label: `${s.name} · ${s.admissionNumber}` }))}
            onChange={v => update('studentId', v)}
          />
          <Button title="Save record" onPress={save} busy={busy} />
        </Card>
      )}
      {loading ? <Busy /> : !items.length ? <Empty text="No invoices yet." /> : items.map(i => (
        <Card key={i._id} onPress={() => navigation.navigate('InvoiceDetail', { invoice: i })}>
          <Label>{i.title}</Label>
          <Muted>
            {i.studentId?.name}
            {'\n'}PKR {(i.amount / 100).toLocaleString()} · Due {(i.balance / 100).toLocaleString()}
            {'\n'}{i.dueDate} · Tap for payments
          </Muted>
        </Card>
      ))}
    </Page>
  );
}
