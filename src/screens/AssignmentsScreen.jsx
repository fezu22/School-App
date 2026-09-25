import React, { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
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
} from '../components/UI';
export default function AssignmentsScreen({ navigation }) {
  const { user } = useAuth();
  const [items, setItems] = useState([]),
    [classes, setClasses] = useState([]),
    [form, setForm] = useState({}),
    [adding, setAdding] = useState(false),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const update = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const canCreate = ['SUPER_ADMIN', 'PRINCIPAL', 'TEACHER'].includes(user.role);
  const load = useCallback(async () => {
    try {
      setItems((await api('/assignments')).items);
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
      setClasses((await api('/classes')).items);
      setAdding(true);
    } catch (e) {
      setError(e.message);
    }
  }
  async function save() {
    setBusy(true);
    try {
      await api('/assignments', 'POST', {
        ...form,
        maxMarks: Number(form.maxMarks),
        published: false,
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
  const subjects = (
    classes.find(c => c._id === form.classId)?.subjects || []
  ).filter(s => user.role !== 'TEACHER' || user.subjectNames.includes(s));
  return (
    <Page>
      <Title>Assignments</Title>
      <ErrorText message={error} />
      {canCreate && (
        <Button
          title={adding ? 'Cancel' : 'New assignment draft'}
          onPress={() => (adding ? setAdding(false) : open())}
        />
      )}{' '}
      {adding && (
        <Card>
          <Field
            label="Title"
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
            label="Instructions"
            value={form.instructions || ''}
            onChangeText={v => update('instructions', v)}
            multiline
          />
          <Field
            label="Due date (YYYY-MM-DD)"
            value={form.dueDate || ''}
            onChangeText={v => update('dueDate', v)}
          />
          <Field
            label="Maximum marks"
            value={form.maxMarks || ''}
            onChangeText={v => update('maxMarks', v)}
            keyboardType="numeric"
          />
          <Button title="Save draft" onPress={save} busy={busy} />
        </Card>
      )}
      {!items.length && <Empty text="No assignments available yet." />}
      {items.map(item => (
        <Card
          key={item._id}
          onPress={() =>
            navigation.navigate('AssignmentDetail', { assignment: item })
          }
        >
          <Title>{item.title}</Title>
          <Muted>
            {item.subject} · {item.classId?.name} {item.classId?.section}
            {'\n'}Due {item.dueDate} · {item.published ? 'Published' : 'Draft'}
          </Muted>
        </Card>
      ))}
    </Page>
  );
}
