import React, { useState } from 'react';
import { RefreshControl } from 'react-native';
import { api } from '../../../api/client';
import { useAuth } from '../../../auth/AuthContext';
import { useList } from '../../../api/useList';
import { Page, Card, Title, Label, Muted, Field, Button, Choice, ErrorText, Empty, Busy } from '../../../components/UI';

const CAN_CREATE = ['SUPER_ADMIN', 'PRINCIPAL', 'ACADEMIC_COORDINATOR'];
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export default function StaffTimetableScreen() {
  const { user } = useAuth();
  const { items, loading, error, setError, load } = useList('/staff/timetable');
  const [adding, setAdding] = useState(false),
    [classes, setClasses] = useState([]),
    [form, setForm] = useState({ day: 'Monday' }),
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
      await api('/staff/timetable', 'POST', form);
      setAdding(false);
      setForm({ day: 'Monday' });
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Page refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
      <Title>Timetable</Title>
      <ErrorText message={error} />
      {CAN_CREATE.includes(user.role) && (
        <Button title={adding ? 'Cancel' : 'Add period'} onPress={() => (adding ? setAdding(false) : openForm())} />
      )}
      {adding && (
        <Card>
          {[['start', 'Start (HH:MM)'], ['end', 'End (HH:MM)'], ['subject', 'Subject'], ['room', 'Room']].map(([k, label]) => (
            <Field key={k} label={label} value={form[k] || ''} onChangeText={v => update(k, v)} />
          ))}
          <Choice
            label="Class"
            value={form.classId}
            options={classes.map(c => ({ value: c._id, label: `${c.name} ${c.section}` }))}
            onChange={v => update('classId', v)}
          />
          <Choice label="Day" value={form.day} options={DAYS.map(v => ({ value: v, label: v }))} onChange={v => update('day', v)} />
          <Button title="Save record" onPress={save} busy={busy} />
        </Card>
      )}
      {loading ? <Busy /> : !items.length ? <Empty /> : items.map(t => (
        <Card key={t._id}>
          <Label>{t.subject}</Label>
          <Muted>
            {t.day} · {t.start}–{t.end}
            {'\n'}{t.classId?.name} {t.classId?.section} · {t.room}
          </Muted>
        </Card>
      ))}
    </Page>
  );
}
