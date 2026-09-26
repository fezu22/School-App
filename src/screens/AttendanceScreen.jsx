import React, { useEffect, useState } from 'react';
import { Alert } from 'react-native';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import {
  Page,
  Card,
  Title,
  Muted,
  Field,
  Choice,
  Button,
  ErrorText,
  Empty,
} from '../components/UI';
export default function AttendanceScreen() {
  const { user } = useAuth();
  const canMark = ['SUPER_ADMIN', 'PRINCIPAL', 'TEACHER'].includes(user.role);
  const [classes, setClasses] = useState([]),
    [classId, setClassId] = useState(''),
    [date, setDate] = useState(new Date().toLocaleDateString('en-CA')),
    [roster, setRoster] = useState([]),
    [records, setRecords] = useState([]),
    [marks, setMarks] = useState({}),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    api('/classes')
      .then(d => setClasses(d.items))
      .catch(e => setError(e.message));
  }, []);
  async function load() {
    setBusy(true);
    setError('');
    try {
      const d = await api(
        `/attendance?date=${date}${classId ? '&classId=' + classId : ''}`,
      );
      setRecords(d.items);
      if (canMark) {
        if (!classId) throw Error('Select a class');
        const students = await api('/students?classId=' + classId);
        setRoster(students.items);
        const values = {};
        d.items.forEach(r => (values[r.studentId._id] = r.status));
        setMarks(values);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    const entries = roster.map(s => ({
      studentId: s._id,
      status: marks[s._id],
    }));
    if (entries.some(e => !e.status))
      return setError('Choose a status for every student');
    Alert.alert(
      'Submit attendance?',
      `${date} · ${entries.length} students. Existing attendance for this date will be updated and audited.`,
      [
        { text: 'Cancel' },
        {
          text: 'Submit',
          onPress: async () => {
            setBusy(true);
            try {
              await api('/attendance', 'POST', { classId, date, entries });
              await load();
              Alert.alert('Saved', 'Attendance recorded');
            } catch (e) {
              setError(e.message);
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  }
  return (
    <Page>
      <Title>Attendance</Title>
      <Field
        label="Date (YYYY-MM-DD)"
        value={date}
        onChangeText={v => {
          setDate(v);
          setRoster([]);
        }}
      />
      <Choice
        label="Class"
        options={classes.map(c => ({
          value: c._id,
          label: `${c.name} ${c.section}`,
        }))}
        value={classId}
        onChange={v => {
          setClassId(v);
          setRoster([]);
        }}
      />
      <Button title="Load attendance" onPress={load} busy={busy} />
      <ErrorText message={error} />
      {canMark
        ? roster.map(s => (
            <Card key={s._id}>
              <Title>{s.name}</Title>
              <Muted>{s.admissionNumber}</Muted>
              <Choice
                label="Status"
                options={['PRESENT', 'ABSENT', 'LATE', 'EXCUSED'].map(v => ({
                  value: v,
                  label: v,
                }))}
                value={marks[s._id]}
                onChange={v => setMarks(m => ({ ...m, [s._id]: v }))}
              />
            </Card>
          ))
        : records.map(r => (
            <Card key={r._id}>
              <Title>{r.studentId?.name}</Title>
              <Muted>
                {r.date} · {r.status}
              </Muted>
            </Card>
          ))}
      {canMark && roster.length > 0 && (
        <>
          <Button
            title="Mark all present"
            secondary
            onPress={() =>
              setMarks(Object.fromEntries(roster.map(s => [s._id, 'PRESENT'])))
            }
          />
          <Button title="Review and submit" onPress={save} busy={busy} />
        </>
      )}
      {!roster.length && !records.length && (
        <Empty text="Choose a class and date to load real attendance records." />
      )}
    </Page>
  );
}
