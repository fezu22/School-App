import React, { useState } from 'react';
import { RefreshControl } from 'react-native';
import { api } from '../../../api/client';
import { useAuth } from '../../../auth/AuthContext';
import { useList } from '../../../api/useList';
import { Page, Card, Title, Label, Muted, Field, Button, Choice, ErrorText, Empty, Busy } from '../../../components/UI';

const CAN_CREATE = ['SUPER_ADMIN', 'PRINCIPAL'];
export default function StaffStudentsScreen() {
  const { user } = useAuth();
  const { items, loading, error, setError, load } = useList('/staff/students');
  const [adding, setAdding] = useState(false),
    [classes, setClasses] = useState([]),
    [form, setForm] = useState({}),
    [busy, setBusy] = useState(false);
  const update = (k, v) => setForm(f => ({ ...f, [k]: v }));
  async function openForm() {
    try {
      setClasses((await api('/staff/classes')).items);
      setAdding(true);
    } catch (e) {
      setError(e.message);
    }
  }
  async function save() {
    setBusy(true);
    setError('');
    try {
      await api('/staff/students', 'POST', form);
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
      <Title>Students</Title>
      <ErrorText message={error} />
      {CAN_CREATE.includes(user.role) && (
        <Button title={adding ? 'Cancel' : 'Add student'} onPress={() => (adding ? setAdding(false) : openForm())} />
      )}
      {adding && (
        <Card>
          {[['name', 'Student name'], ['admissionNumber', 'Admission number'], ['guardianName', 'Guardian name'], ['guardianPhone', 'Guardian phone']].map(([k, label]) => (
            <Field key={k} label={label} value={form[k] || ''} onChangeText={v => update(k, v)} />
          ))}
          <Choice
            label="Class"
            value={form.classId}
            options={classes.map(c => ({ value: c._id, label: `${c.name} ${c.section}` }))}
            onChange={v => update('classId', v)}
          />
          <Button title="Save record" onPress={save} busy={busy} />
        </Card>
      )}
      {loading ? <Busy /> : !items.length ? <Empty /> : items.map(s => (
        <Card key={s._id}>
          <Label>{s.name}</Label>
          <Muted>
            {s.admissionNumber} · {s.classId?.name} {s.classId?.section}
            {'\n'}Guardian: {s.guardianName}
          </Muted>
        </Card>
      ))}
    </Page>
  );
}
