import React, { useState } from 'react';
import { Alert, RefreshControl } from 'react-native';
import { api } from '../../../api/client';
import { useList } from '../../../api/useList';
import { Page, Card, Title, Label, Muted, Field, Button, Choice, ErrorText, Empty, Busy } from '../../../components/UI';

// SUPER_ADMIN only.
const ROLES = [
  'PRINCIPAL', 'TEACHER', 'ACCOUNTANT', 'EXAM_OFFICER', 'ACADEMIC_COORDINATOR', 'HR',
  'LIBRARIAN', 'INVENTORY', 'TRANSPORT', 'HOSTEL', 'STUDENT', 'PARENT', 'AUDITOR', 'IT_SUPPORT',
];
const ref = x => (typeof x === 'object' ? x?._id : x);
const blank = { role: 'TEACHER', branchIds: [], classIds: [], studentIds: [], subjectNames: [] };
const opts = (rows, label) => rows.map(x => ({ value: x._id, label: label(x) }));

export default function UsersScreen() {
  const { items, loading, error, setError, load } = useList('/staff/admin/users');
  const [adding, setAdding] = useState(false),
    [editing, setEditing] = useState(null),
    [lookups, setLookups] = useState({ branches: [], classes: [], students: [] }),
    [form, setForm] = useState(blank),
    [verified, setVerified] = useState(false),
    [busy, setBusy] = useState(false);
  const update = (k, v) => setForm(f => ({ ...f, [k]: v }));
  async function openForm(item) {
    setBusy(true);
    setError('');
    try {
      const [branches, classes, students] = await Promise.all([api('/staff/branches'), api('/staff/classes'), api('/staff/students')]);
      setLookups({ branches: branches.items, classes: classes.items, students: students.items });
      setEditing(item || null);
      setForm(item ? { ...item } : blank);
      setVerified(false);
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
      if (!editing && form.role === 'PARENT' && !verified)
        throw Error('Confirm the guardian-child relationship first');
      if (editing) {
        await api(`/staff/admin/users/${editing._id}/scope`, 'PATCH', {
          branchIds: form.branchIds,
          classIds: form.classIds,
          studentIds: form.studentIds,
          subjectNames: form.subjectNames,
        });
      } else {
        await api('/staff/admin/users', 'POST', form);
      }
      setAdding(false);
      setForm(blank);
      setVerified(false);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  function toggleUser(item) {
    Alert.alert(item.active ? 'Disable account?' : 'Enable account?', item.email, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Confirm',
        onPress: async () => {
          try {
            await api(`/staff/admin/users/${item._id}/active`, 'PATCH', { active: !item.active });
            await load();
          } catch (e) {
            setError(e.message);
          }
        },
      },
    ]);
  }
  const classOptions = opts(
    lookups.classes.filter(c => (form.branchIds || []).includes(ref(c.branchId))),
    c => `${c.name} ${c.section}`,
  );
  const subjectOptions = [
    ...new Set(lookups.classes.filter(c => (form.classIds || []).includes(c._id)).flatMap(c => c.subjects)),
  ].map(v => ({ value: v, label: v }));
  return (
    <Page refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
      <Title>Users</Title>
      <ErrorText message={error} />
      <Button title={adding ? 'Cancel' : 'Add user'} onPress={() => (adding ? setAdding(false) : openForm())} busy={busy && !adding} />
      {adding && (
        <Card>
          {!editing && (
            <>
              <Field label="Full name" value={form.name || ''} onChangeText={v => update('name', v)} />
              <Field label="Email address" value={form.email || ''} onChangeText={v => update('email', v)} keyboardType="email-address" />
              <Field label="Temporary password (12+ characters)" value={form.password || ''} onChangeText={v => update('password', v)} password />
              <Choice
                label="Account role"
                value={form.role}
                options={ROLES.map(v => ({ value: v, label: v.replaceAll('_', ' ') }))}
                onChange={v => update('role', v)}
              />
            </>
          )}
          <Choice
            label="Assigned branches"
            multiple
            value={form.branchIds}
            options={opts(lookups.branches, b => b.name)}
            onChange={v => {
              update('branchIds', v);
              update('classIds', []);
            }}
          />
          {form.role === 'TEACHER' && (
            <>
              <Choice label="Assigned classes" multiple value={form.classIds} options={classOptions} onChange={v => update('classIds', v)} />
              <Choice label="Assigned subjects" multiple value={form.subjectNames} options={subjectOptions} onChange={v => update('subjectNames', v)} />
            </>
          )}
          {['PARENT', 'STUDENT'].includes(form.role) && (
            <Choice
              label="Linked student records"
              multiple
              value={form.studentIds}
              options={opts(lookups.students, s => `${s.name} · ${s.admissionNumber}`)}
              onChange={v => update('studentIds', v)}
            />
          )}
          {!editing && form.role === 'PARENT' && (
            <Choice
              label="Guardian verification"
              value={verified ? 'yes' : ''}
              options={[{ value: 'yes', label: 'I verified this guardian and child relationship' }]}
              onChange={() => setVerified(!verified)}
            />
          )}
          <Button title="Save record" onPress={save} busy={busy} />
        </Card>
      )}
      {loading ? <Busy /> : !items.length ? <Empty /> : items.map(u => (
        <Card key={u._id}>
          <Label>{u.name}</Label>
          <Muted>
            {u.email}
            {'\n'}{u.role} · {u.active ? 'Active' : 'Disabled'}
          </Muted>
          {u.role !== 'SUPER_ADMIN' && (
            <>
              <Button title="Edit assigned access" secondary onPress={() => openForm(u)} />
              <Button title={u.active ? 'Disable account' : 'Enable account'} secondary onPress={() => toggleUser(u)} />
            </>
          )}
        </Card>
      ))}
    </Page>
  );
}
