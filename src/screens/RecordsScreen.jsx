import React, { useCallback, useState } from 'react';
import { Alert, RefreshControl } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import {
  Page,
  Card,
  Title,
  Label,
  Muted,
  Field,
  Button,
  Choice,
  ErrorText,
  Empty,
  Busy,
} from '../components/UI';
const ROLES = [
  'PRINCIPAL',
  'TEACHER',
  'ACCOUNTANT',
  'EXAM_OFFICER',
  'ACADEMIC_COORDINATOR',
  'HR',
  'LIBRARIAN',
  'INVENTORY',
  'TRANSPORT',
  'HOSTEL',
  'STUDENT',
  'PARENT',
  'AUDITOR',
  'IT_SUPPORT',
];
const configurations = {
  Branches: {
    path: '/admin/branches',
    create: ['SUPER_ADMIN'],
    fields: [
      ['name', 'Branch name'],
      ['address', 'Address'],
      ['phone', 'Phone'],
    ],
  },
  Classes: {
    path: '/classes',
    create: ['SUPER_ADMIN', 'PRINCIPAL', 'ACADEMIC_COORDINATOR'],
    fields: [
      ['name', 'Class name'],
      ['section', 'Section'],
      ['session', 'Academic session'],
      ['subjects', 'Subjects (comma separated)'],
    ],
  },
  Students: {
    path: '/students',
    create: ['SUPER_ADMIN', 'PRINCIPAL'],
    fields: [
      ['name', 'Student name'],
      ['admissionNumber', 'Admission number'],
      ['guardianName', 'Guardian name'],
      ['guardianPhone', 'Guardian phone'],
    ],
  },
  Users: {
    path: '/admin/users',
    create: ['SUPER_ADMIN'],
    fields: [
      ['name', 'Full name'],
      ['email', 'Email address'],
      ['password', 'Temporary password (12+ characters)'],
    ],
  },
  Notices: {
    path: '/notices',
    create: ['SUPER_ADMIN', 'PRINCIPAL', 'TEACHER'],
    fields: [
      ['title', 'Title'],
      ['body', 'Message'],
    ],
  },
  Timetable: {
    path: '/timetable',
    create: ['SUPER_ADMIN', 'PRINCIPAL', 'ACADEMIC_COORDINATOR'],
    fields: [
      ['start', 'Start (HH:MM)'],
      ['end', 'End (HH:MM)'],
      ['subject', 'Subject'],
      ['room', 'Room'],
    ],
  },
  Invoices: {
    path: '/invoices',
    create: ['SUPER_ADMIN', 'ACCOUNTANT'],
    fields: [
      ['title', 'Fee description'],
      ['amount', 'Amount in PKR'],
      ['dueDate', 'Due date (YYYY-MM-DD)'],
    ],
  },
  Audit: { path: '/admin/audit', create: [], fields: [] },
};
const ref = x => (typeof x === 'object' ? x?._id : x);
export default function RecordsScreen({ route, navigation }) {
  const key = route.name,
    config = configurations[key];
  const { user } = useAuth();
  const [items, setItems] = useState([]),
    [lookups, setLookups] = useState({
      branches: [],
      classes: [],
      students: [],
    }),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [adding, setAdding] = useState(false),
    [busy, setBusy] = useState(false),
    [form, setForm] = useState({
      role: 'TEACHER',
      branchIds: [],
      classIds: [],
      studentIds: [],
      subjectNames: [],
      day: 'Monday',
    }),
    [verified, setVerified] = useState(false),
    [editing, setEditing] = useState(null);
  const update = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const load = useCallback(async () => {
    setError('');
    try {
      const data = await api(config.path);
      setItems(data.items);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [config.path]);
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );
  async function openForm(item) {
    setBusy(true);
    setError('');
    try {
      const [branches, classes, students] = await Promise.all([
        api('/branches'),
        api('/classes'),
        api('/students'),
      ]);
      setLookups({
        branches: branches.items,
        classes: classes.items,
        students: students.items,
      });
      setEditing(item || null);
      if (item) setForm({ ...item });
      else
        setForm({
          role: 'TEACHER',
          branchIds: [],
          classIds: [],
          studentIds: [],
          subjectNames: [],
          day: 'Monday',
        });
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
      let body = { ...form };
      if (key === 'Classes')
        body.subjects = (form.subjects || '')
          .split(',')
          .map(x => x.trim())
          .filter(Boolean);
      if (key === 'Invoices') {
        const amount = Number(form.amount);
        if (!Number.isFinite(amount)) throw Error('Enter a valid amount');
        body.amount = Math.round(amount * 100);
      }
      if (key === 'Notices' && !body.classId) delete body.classId;
      if (key === 'Users' && body.role === 'PARENT' && !verified)
        throw Error('Confirm the guardian-child relationship first');
      if (editing) {
        await api(`/admin/users/${editing._id}/scope`, 'PATCH', {
          branchIds: body.branchIds,
          classIds: body.classIds,
          studentIds: body.studentIds,
          subjectNames: body.subjectNames,
        });
      } else {
        await api(config.path, 'POST', body);
      }
      setAdding(false);
      setForm({
        role: 'TEACHER',
        branchIds: [],
        classIds: [],
        studentIds: [],
        subjectNames: [],
        day: 'Monday',
      });
      setVerified(false);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function toggleUser(item) {
    Alert.alert(
      item.active ? 'Disable account?' : 'Enable account?',
      item.email,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm',
          onPress: async () => {
            try {
              await api(`/admin/users/${item._id}/active`, 'PATCH', {
                active: !item.active,
              });
              await load();
            } catch (e) {
              setError(e.message);
            }
          },
        },
      ],
    );
  }
  const options = (rows, label) =>
    rows.map(x => ({ value: x._id, label: label(x) }));
  const cls = options(lookups.classes, c => `${c.name} ${c.section}`);
  const branches = options(lookups.branches, b => b.name);
  const students = options(
    lookups.students,
    s => `${s.name} · ${s.admissionNumber}`,
  );
  return (
    <Page
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
    >
      <Title>{key === 'Invoices' ? 'Fees & receipts' : key}</Title>
      <ErrorText message={error} />
      {config.create.includes(user.role) && (
        <Button
          title={
            adding
              ? 'Cancel'
              : 'Add ' +
                ({
                  Classes: 'class',
                  Branches: 'branch',
                  Students: 'student',
                  Users: 'user',
                  Notices: 'notice',
                  Timetable: 'period',
                  Invoices: 'invoice',
                }[key] || 'record')
          }
          onPress={() => (adding ? setAdding(false) : openForm())}
          busy={busy && !adding}
        />
      )}{' '}
      {adding && (
        <Card>
          {config.fields
            .filter(() => !editing)
            .map(([name, label]) => (
              <Field
                key={name}
                label={label}
                value={form[name] || ''}
                onChangeText={v => update(name, v)}
                password={name === 'password'}
                multiline={name === 'body'}
                keyboardType={
                  name === 'amount'
                    ? 'decimal-pad'
                    : name === 'email'
                    ? 'email-address'
                    : undefined
                }
              />
            ))}
          {['Classes', 'Notices'].includes(key) && (
            <Choice
              label="Branch"
              value={form.branchId}
              options={branches}
              onChange={v => {
                update('branchId', v);
                update('classId', undefined);
              }}
            />
          )}
          {['Students', 'Timetable', 'Notices'].includes(key) && (
            <Choice
              label={
                key === 'Notices' ? 'Class (required for teachers)' : 'Class'
              }
              value={form.classId}
              options={
                key === 'Notices'
                  ? options(
                      lookups.classes.filter(
                        c => ref(c.branchId) === form.branchId,
                      ),
                      c => `${c.name} ${c.section}`,
                    )
                  : cls
              }
              onChange={v => update('classId', v)}
            />
          )}
          {key === 'Timetable' && (
            <Choice
              label="Day"
              options={[
                'Monday',
                'Tuesday',
                'Wednesday',
                'Thursday',
                'Friday',
                'Saturday',
                'Sunday',
              ].map(v => ({ value: v, label: v }))}
              value={form.day}
              onChange={v => update('day', v)}
            />
          )}
          {key === 'Invoices' && (
            <Choice
              label="Student"
              value={form.studentId}
              options={students}
              onChange={v => update('studentId', v)}
            />
          )}
          {key === 'Users' && (
            <>
              {!editing && (
                <Choice
                  label="Account role"
                  value={form.role}
                  options={ROLES.map(v => ({
                    value: v,
                    label: v.replaceAll('_', ' '),
                  }))}
                  onChange={v => update('role', v)}
                />
              )}
              <Choice
                label="Assigned branches"
                multiple
                value={form.branchIds}
                options={branches}
                onChange={v => {
                  update('branchIds', v);
                  update('classIds', []);
                }}
              />
              {form.role === 'TEACHER' && (
                <>
                  <Choice
                    label="Assigned classes"
                    multiple
                    value={form.classIds}
                    options={options(
                      lookups.classes.filter(c =>
                        (form.branchIds || []).includes(ref(c.branchId)),
                      ),
                      c => `${c.name} ${c.section}`,
                    )}
                    onChange={v => update('classIds', v)}
                  />
                  <Choice
                    label="Assigned subjects"
                    multiple
                    value={form.subjectNames}
                    options={[
                      ...new Set(
                        lookups.classes
                          .filter(c => (form.classIds || []).includes(c._id))
                          .flatMap(c => c.subjects),
                      ),
                    ].map(v => ({ value: v, label: v }))}
                    onChange={v => update('subjectNames', v)}
                  />
                </>
              )}
              {['PARENT', 'STUDENT'].includes(form.role) && (
                <Choice
                  label="Linked student records"
                  multiple
                  value={form.studentIds}
                  options={students}
                  onChange={v => update('studentIds', v)}
                />
              )}
              {form.role === 'PARENT' && (
                <Choice
                  label="Guardian verification"
                  value={verified ? 'yes' : ''}
                  options={[
                    {
                      value: 'yes',
                      label: 'I verified this guardian and child relationship',
                    },
                  ]}
                  onChange={() => setVerified(!verified)}
                />
              )}
            </>
          )}
          <Button title="Save record" onPress={save} busy={busy} />
        </Card>
      )}
      {loading ? (
        <Busy />
      ) : !items.length ? (
        <Empty text="Your database has no records in this section. Add your school's real information to begin." />
      ) : (
        items.map(item => (
          <Card
            key={item._id}
            onPress={
              key === 'Invoices'
                ? () => navigation.navigate('InvoiceDetail', { invoice: item })
                : undefined
            }
          >
            <Label>
              {item.name || item.title || item.subject || item.action}
            </Label>
            {key === 'Classes' && (
              <Muted>
                {item.section} · {item.session} · {item.branchId?.name}
                {'\n'}
                {item.subjects.join(', ')}
              </Muted>
            )}
            {key === 'Students' && (
              <Muted>
                {item.admissionNumber} · {item.classId?.name}{' '}
                {item.classId?.section}
                {'\n'}Guardian: {item.guardianName}
              </Muted>
            )}
            {key === 'Users' && (
              <>
                <Muted>
                  {item.email}
                  {'\n'}
                  {item.role} · {item.active ? 'Active' : 'Disabled'}
                </Muted>
                {item.role !== 'SUPER_ADMIN' && (
                  <>
                    <Button
                      title="Edit assigned access"
                      secondary
                      onPress={() => openForm(item)}
                    />
                    <Button
                      title={item.active ? 'Disable account' : 'Enable account'}
                      secondary
                      onPress={() => toggleUser(item)}
                    />
                  </>
                )}
              </>
            )}
            {key === 'Notices' && <Muted>{item.body}</Muted>}
            {key === 'Branches' && (
              <Muted>
                {item.address}
                {'\n'}
                {item.phone}
              </Muted>
            )}
            {key === 'Timetable' && (
              <Muted>
                {item.day} · {item.start}–{item.end}
                {'\n'}
                {item.classId?.name} {item.classId?.section} · {item.room}
              </Muted>
            )}
            {key === 'Invoices' && (
              <Muted>
                {item.studentId?.name}
                {'\n'}PKR {(item.amount / 100).toLocaleString()} · Due{' '}
                {(item.balance / 100).toLocaleString()}
                {'\n'}
                {item.dueDate} · Tap for payments
              </Muted>
            )}
            {key === 'Audit' && (
              <Muted>
                {item.actor?.name || 'User'} · {item.entity}
                {'\n'}
                {new Date(item.createdAt).toLocaleString()}
              </Muted>
            )}
          </Card>
        ))
      )}
    </Page>
  );
}
