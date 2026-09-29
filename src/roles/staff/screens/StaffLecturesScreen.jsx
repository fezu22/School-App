import React, { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { api } from '../../../api/client';
import { useAuth } from '../../../auth/AuthContext';
import {
  Page,
  Card,
  Title,
  Muted,
  Field,
  Button,
  Choice,
  ErrorText,
  Empty,
} from '../../../components/UI';
export default function StaffLecturesScreen({ navigation }) {
  const { user } = useAuth();
  const [items, setItems] = useState([]),
    [classes, setClasses] = useState([]),
    [form, setForm] = useState({}),
    [adding, setAdding] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const staff = ['SUPER_ADMIN', 'PRINCIPAL', 'TEACHER'].includes(user.role);
  const update = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const load = useCallback(async () => {
    try {
      setItems((await api('/staff/lectures')).items);
    } catch (e) {
      setError(e.message);
    }
  }, []);
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );
  async function open() {
    try {
      setClasses((await api('/staff/classes')).items);
      setAdding(true);
    } catch (e) {
      setError(e.message);
    }
  }
  async function save() {
    setBusy(true);
    try {
      const data = await api('/staff/lectures', 'POST', form);
      setAdding(false);
      setForm({});
      navigation.navigate('LectureDetail', { lectureId: data.item._id });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const subjects = (
    classes.find(c => c._id === form.classId)?.subjects || []
  ).filter(s => user.role !== 'TEACHER' || user.subjectNames.includes(s));
  return (
    <Page>
      <Title>AI learning</Title>
      <Muted>
        {staff
          ? 'Add your lecture transcript, then generate and review learning material.'
          : 'Published summaries, homework and quizzes.'}
      </Muted>
      <ErrorText message={error} />
      {staff && (
        <Button
          title={adding ? 'Cancel' : 'Add lecture transcript'}
          onPress={() => (adding ? setAdding(false) : open())}
        />
      )}{' '}
      {adding && (
        <Card>
          <Field
            label="Lecture title"
            value={form.title || ''}
            onChangeText={v => update('title', v)}
          />
          <Choice
            label="Class"
            options={classes.map(c => ({
              value: c._id,
              label: `${c.name} ${c.section}`,
            }))}
            value={form.classId}
            onChange={v => {
              update('classId', v);
              update('subject', '');
            }}
          />
          <Choice
            label="Subject"
            options={subjects.map(v => ({ value: v, label: v }))}
            value={form.subject}
            onChange={v => update('subject', v)}
          />
          <Field
            label="Transcript (minimum 100 characters)"
            value={form.transcript || ''}
            onChangeText={v => update('transcript', v)}
            multiline
          />
          <Button title="Save lecture" onPress={save} busy={busy} />
        </Card>
      )}
      {!items.length && <Empty text="No lecture content yet." />}
      {items.map(l => (
        <Card
          key={l._id}
          onPress={() =>
            navigation.navigate('LectureDetail', { lectureId: l._id })
          }
        >
          <Title>{l.title}</Title>
          <Muted>
            {l.subject} · {l.state}
          </Muted>
        </Card>
      ))}
    </Page>
  );
}
