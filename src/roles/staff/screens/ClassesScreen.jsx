import React, { useState } from 'react';
import { RefreshControl } from 'react-native';
import { api } from '../../../api/client';
import { useAuth } from '../../../auth/AuthContext';
import { useList } from '../../../api/useList';
import { Page, Card, Title, Label, Muted, Field, Button, Choice, ErrorText, Empty, Busy } from '../../../components/UI';

const CAN_CREATE = ['SUPER_ADMIN', 'PRINCIPAL', 'ACADEMIC_COORDINATOR'];
export default function ClassesScreen() {
  const { user } = useAuth();
  const { items, loading, error, setError, load } = useList('/staff/classes');
  const [adding, setAdding] = useState(false),
    [branches, setBranches] = useState([]),
    [form, setForm] = useState({}),
    [busy, setBusy] = useState(false);
  const update = (k, v) => setForm(f => ({ ...f, [k]: v }));
  async function openForm() {
    try {
      setBranches((await api('/staff/branches')).items);
      setAdding(true);
    } catch (e) {
      setError(e.message);
    }
  }
  async function save() {
    setBusy(true);
    setError('');
    try {
      await api('/staff/classes', 'POST', {
        ...form,
        subjects: (form.subjects || '').split(',').map(x => x.trim()).filter(Boolean),
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
      <Title>Classes</Title>
      <ErrorText message={error} />
      {CAN_CREATE.includes(user.role) && (
        <Button title={adding ? 'Cancel' : 'Add class'} onPress={() => (adding ? setAdding(false) : openForm())} />
      )}
      {adding && (
        <Card>
          {[['name', 'Class name'], ['section', 'Section'], ['session', 'Academic session'], ['subjects', 'Subjects (comma separated)']].map(([k, label]) => (
            <Field key={k} label={label} value={form[k] || ''} onChangeText={v => update(k, v)} />
          ))}
          <Choice
            label="Branch"
            value={form.branchId}
            options={branches.map(b => ({ value: b._id, label: b.name }))}
            onChange={v => update('branchId', v)}
          />
          <Button title="Save record" onPress={save} busy={busy} />
        </Card>
      )}
      {loading ? <Busy /> : !items.length ? <Empty /> : items.map(c => (
        <Card key={c._id}>
          <Label>{c.name}</Label>
          <Muted>
            {c.section} · {c.session} · {c.branchId?.name}
            {'\n'}{c.subjects.join(', ')}
          </Muted>
        </Card>
      ))}
    </Page>
  );
}
