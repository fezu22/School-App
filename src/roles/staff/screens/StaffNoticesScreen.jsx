import React, { useState } from 'react';
import { RefreshControl } from 'react-native';
import { api } from '../../../api/client';
import { useAuth } from '../../../auth/AuthContext';
import { useList } from '../../../api/useList';
import { Page, Card, Title, Label, Muted, Field, Button, Choice, ErrorText, Empty, Busy } from '../../../components/UI';

const CAN_CREATE = ['SUPER_ADMIN', 'PRINCIPAL', 'TEACHER'];
const ref = x => (typeof x === 'object' ? x?._id : x);
export default function StaffNoticesScreen() {
  const { user } = useAuth();
  const { items, loading, error, setError, load } = useList('/staff/notices');
  const [adding, setAdding] = useState(false),
    [lookups, setLookups] = useState({ branches: [], classes: [] }),
    [form, setForm] = useState({}),
    [busy, setBusy] = useState(false);
  const update = (k, v) => setForm(f => ({ ...f, [k]: v }));
  async function openForm() {
    try {
      const [b, c] = await Promise.all([api('/staff/branches'), api('/staff/classes')]);
      setLookups({ branches: b.items, classes: c.items });
      setAdding(true);
    } catch (e) {
      setError(e.message);
    }
  }
  async function save() {
    setBusy(true);
    setError('');
    try {
      const body = { ...form };
      if (!body.classId) delete body.classId;
      await api('/staff/notices', 'POST', body);
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
      <Title>Notices</Title>
      <ErrorText message={error} />
      {CAN_CREATE.includes(user.role) && (
        <Button title={adding ? 'Cancel' : 'Add notice'} onPress={() => (adding ? setAdding(false) : openForm())} />
      )}
      {adding && (
        <Card>
          <Field label="Title" value={form.title || ''} onChangeText={v => update('title', v)} />
          <Field label="Message" value={form.body || ''} onChangeText={v => update('body', v)} multiline />
          <Choice
            label="Branch"
            value={form.branchId}
            options={lookups.branches.map(b => ({ value: b._id, label: b.name }))}
            onChange={v => {
              update('branchId', v);
              update('classId', undefined);
            }}
          />
          <Choice
            label="Class (required for teachers)"
            value={form.classId}
            options={lookups.classes
              .filter(c => ref(c.branchId) === form.branchId)
              .map(c => ({ value: c._id, label: `${c.name} ${c.section}` }))}
            onChange={v => update('classId', v)}
          />
          <Button title="Save record" onPress={save} busy={busy} />
        </Card>
      )}
      {loading ? <Busy /> : !items.length ? <Empty /> : items.map(n => (
        <Card key={n._id}>
          <Label>{n.title}</Label>
          <Muted>{n.body}</Muted>
        </Card>
      ))}
    </Page>
  );
}
