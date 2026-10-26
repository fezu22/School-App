import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../../context/AuthContext';
import { hasPermission, PERMISSIONS } from '../../constants/permissions';
import {
  Button,
  DashboardShell,
  ScreenHeading,
  SectionCard,
  StatusBadge,
} from '../../components/hiraDashboard';
import {
  AdminDateField,
  AdminDialog,
  AdminFeedback,
  AdminSelect,
  formStyles,
} from '../../components/hiraDashboard/AdminForm';
import {
  staffSelfService,
  staffOperationId,
  staffFilesSupported,
  type Appointment,
  type AppointmentStudent,
} from '../../services/teacher/staffSelfService';
import { useTeacherResource } from './useTeacherResource';
import { useTimetableAction } from './useTimetableAction';
import { LoadState, styles } from './teacherUi';

const tabs = ['Leave', 'Payslips', 'Documents', 'PTM / Appointments'] as const;
const localStyles = StyleSheet.create({ tabs: { gap: 8 } });
const validDate = (s: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(s) &&
  !Number.isNaN(Date.parse(s)) &&
  new Date(s).toISOString().slice(0, 10) === s;
const validTime = (s: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
const label = (s: string) => s.replaceAll('_', ' ');
function Badge({ status }: { status: string }) {
  return (
    <StatusBadge
      status={
        ['approved', 'confirmed', 'valid', 'completed'].includes(status)
          ? 'paid'
          : ['expired', 'rejected', 'cancelled'].includes(status)
          ? 'unpaid'
          : 'pending'
      }
      label={label(status)}
    />
  );
}

export default function TeacherSelfServiceScreen() {
  const { user, accessToken } = useAuth();
  const canView = hasPermission(
    user?.role,
    PERMISSIONS.STAFF_SELF_SERVICE_VIEW,
  );
  const canLeave = hasPermission(user?.role, PERMISSIONS.STAFF_LEAVE_REQUEST);
  const canManage = hasPermission(
    user?.role,
    PERMISSIONS.STAFF_APPOINTMENTS_MANAGE_OWN,
  );
  const load = useCallback(() => {
    if (!accessToken || !canView)
      return Promise.reject(
        new Error('Staff Self-Service access is unavailable.'),
      );
    return staffSelfService.summary(accessToken);
  }, [accessToken, canView]);
  const resource = useTeacherResource(
    load,
    'This staff record is unavailable or you no longer have access.',
  );
  const action = useTimetableAction(`staff:${accessToken}`, resource.refresh);
  const [tab, setTab] = useState<(typeof tabs)[number]>('Leave');
  const [dialog, setDialog] = useState<
    'leave' | 'slot' | 'reschedule' | 'confirm' | 'cancel' | 'complete' | null
  >(null);
  const [selected, setSelected] = useState<Appointment | null>(null);
  const [detail, setDetail] = useState<Appointment | null>(null);
  const [leaveType, setLeaveType] = useState('personal'),
    [reason, setReason] = useState('');
  const [startDate, setStartDate] = useState(''),
    [endDate, setEndDate] = useState('');
  const [title, setTitle] = useState(''),
    [date, setDate] = useState('');
  const [startTime, setStartTime] = useState(''),
    [endTime, setEndTime] = useState('');
  const [validation, setValidation] = useState<string | null>(null);
  const [students, setStudents] = useState<AppointmentStudent[]>([]),
    [student, setStudent] = useState('');
  const [studentLoading, setStudentLoading] = useState(false),
    [studentError, setStudentError] = useState<string | null>(null);
  const studentGeneration = useRef(0);
  const fileGeneration = useRef(0);
  const latestFileToken = useRef(accessToken);
  latestFileToken.current = accessToken;
  const retryOperation = useRef<{ key: string; operationId: string } | null>(
    null,
  );
  useFocusEffect(
    useCallback(
      () => () => {
        fileGeneration.current++;
        studentGeneration.current++;
        setDialog(null);
        setDetail(null);
        setStudents([]);
      },
      [],
    ),
  );
  const openFile = (kind: 'payslips' | 'documents', id: string) => {
    const generation = fileGeneration.current;
    return staffSelfService.openFile(
      accessToken!,
      kind,
      id,
      () =>
        fileGeneration.current === generation &&
        latestFileToken.current === accessToken,
    );
  };
  useEffect(() => {
    setDialog(null);
    setDetail(null);
    setSelected(null);
    setStudents([]);
    setReason('');
    setValidation(null);
    retryOperation.current = null;
    studentGeneration.current++;
  }, [accessToken]);
  useEffect(
    () => () => {
      studentGeneration.current++;
    },
    [],
  );
  const loadStudents = async () => {
    const generation = ++studentGeneration.current;
    setStudentLoading(true);
    setStudentError(null);
    setStudents([]);
    try {
      const result = await staffSelfService.students(accessToken!);
      if (studentGeneration.current === generation) setStudents(result.items);
    } catch (e) {
      if (studentGeneration.current === generation)
        setStudentError(
          e instanceof Error ? e.message : 'Unable to load students.',
        );
    } finally {
      if (studentGeneration.current === generation) setStudentLoading(false);
    }
  };
  const open = (next: NonNullable<typeof dialog>, item?: Appointment) => {
    setDialog(next);
    setSelected(item ?? null);
    setValidation(null);
    retryOperation.current = null;
    setDate(item?.date ?? '');
    setStartTime(item?.startTime ?? '');
    setEndTime(item?.endTime ?? '');
    setTitle('');
    setReason('');
    setStartDate('');
    setEndDate('');
    setStudent('');
    if (next === 'confirm') loadStudents();
  };
  const submit = async () => {
    if (!accessToken || !dialog) return;
    let body: Record<string, unknown>;
    if (dialog === 'leave') {
      if (
        !validDate(startDate) ||
        !validDate(endDate) ||
        endDate < startDate ||
        reason.trim().length < 3
      ) {
        setValidation(
          'Enter valid leave dates and a reason of at least 3 characters.',
        );
        return;
      }
      body = { leaveType, startDate, endDate, reason: reason.trim() };
    } else if (dialog === 'slot' || dialog === 'reschedule') {
      if (
        !validDate(date) ||
        !validTime(startTime) ||
        !validTime(endTime) ||
        endTime <= startTime ||
        (dialog === 'slot' && title.trim().length < 3)
      ) {
        setValidation(
          'Enter a title, valid date and a time range with end after start.',
        );
        return;
      }
      body = {
        date,
        startTime,
        endTime,
        ...(dialog === 'slot'
          ? { title: title.trim() }
          : { revision: selected!.revision }),
      };
    } else {
      body = { revision: selected!.revision };
      if (dialog === 'confirm' && student) {
        const target = students.find((_, index) => String(index) === student);
        if (!target) {
          setValidation('Reload the students and select an available learner.');
          return;
        }
        body = {
          ...body,
          studentId: target.studentId,
          classId: target.classId,
          sectionId: target.sectionId,
          subjectId: target.subjectId,
        };
      }
    }
    setValidation(null);
    // Keep the same operation ID after timeout/offline failure with unchanged
    // intent. Changing the form creates a new intent; the server checks overlap.
    const key = JSON.stringify({ dialog, id: selected?.appointmentId, body });
    if (retryOperation.current?.key !== key)
      retryOperation.current = { key, operationId: staffOperationId() };
    body.clientOperationId = retryOperation.current.operationId;
    const currentDialog = dialog;
    const success = await action.run(
      () =>
        currentDialog === 'leave'
          ? staffSelfService.leave(accessToken, body)
          : currentDialog === 'slot'
          ? staffSelfService.slot(accessToken, body)
          : staffSelfService.change(
              accessToken,
              selected!.appointmentId,
              currentDialog,
              body,
            ),
      currentDialog === 'leave'
        ? 'Leave request submitted for approval.'
        : 'Meeting update confirmed by the server.',
    );
    if (success) {
      setDialog(null);
      retryOperation.current = null;
    }
  };
  const data = resource.data;
  const pending =
    data?.leave.items.filter(i =>
      ['pending', 'changes_requested'].includes(i.status),
    ).length ?? 0;
  const nextMeeting = data?.appointments.items.find(
    i =>
      i.status === 'confirmed' &&
      (i.date > data.appointments.today ||
        (i.date === data.appointments.today &&
          i.endTime > data.appointments.time)),
  );
  const dialogTitle =
    dialog === 'leave'
      ? 'Request leave'
      : dialog === 'slot'
      ? 'Offer slot'
      : dialog === 'reschedule'
      ? 'Reschedule meeting'
      : dialog === 'confirm'
      ? 'Confirm meeting'
      : dialog === 'complete'
      ? 'Complete meeting'
      : 'Cancel meeting';
  return (
    <DashboardShell
      refreshing={resource.loading}
      onRefresh={resource.refresh}
      keyboardShouldPersistTaps="handled"
    >
      <ScreenHeading
        title="Staff Self-Service"
        subtitle="Your leave, payslips, documents and meetings"
      />
      <LoadState
        loading={resource.loading}
        error={resource.error}
        retry={resource.refresh}
        label="Loading your staff records..."
      />
      {action.notice ? (
        <AdminFeedback
          kind="success"
          title="Confirmed"
          message={action.notice}
        />
      ) : null}
      {action.error && !dialog ? (
        <AdminFeedback
          kind="error"
          title="Not completed"
          message={action.error}
        />
      ) : null}
      {data ? (
        <>
          <SectionCard title="At a glance">
            <Text style={styles.body}>
              {pending} pending leave requests ·{' '}
              {
                data.documents.items.filter(d =>
                  ['expired', 'expiring_soon'].includes(d.status),
                ).length
              }{' '}
              documents need attention
            </Text>
            <Text style={styles.muted}>
              Latest approved payslip:{' '}
              {data.payslips.items[0]?.period ?? 'None available'}
            </Text>
            <Text style={styles.muted}>
              {nextMeeting
                ? `Next meeting: ${nextMeeting.title} · ${nextMeeting.date} ${nextMeeting.startTime}`
                : 'No upcoming confirmed meetings.'}
            </Text>
          </SectionCard>
          <View accessibilityRole="tablist" style={localStyles.tabs}>
            {tabs.map(t => (
              <Button
                key={t}
                title={t}
                variant={t === tab ? 'primary' : 'secondary'}
                onPress={() => setTab(t)}
              />
            ))}
          </View>
          {tab === 'Leave' ? (
            <>
              <SectionCard title="Leave balance">
                <Text style={styles.muted}>
                  Available balance is not configured. Approved and pending
                  totals count calendar days across your recorded requests.
                </Text>
                {data.leave.balances.map(b => (
                  <Text key={b.leaveType} style={styles.body}>
                    {label(b.leaveType)} · Available:{' '}
                    {b.available ?? 'Not configured'} · Approved:{' '}
                    {b.approvedDays} · Pending: {b.pendingDays}
                  </Text>
                ))}
                {canLeave ? (
                  <Button
                    title="Request Leave"
                    onPress={() => open('leave')}
                    disabled={action.pending}
                  />
                ) : null}
              </SectionCard>
              <SectionCard title="Your leave requests">
                {!data.leave.items.length ? (
                  <Text style={styles.body}>No leave requests yet.</Text>
                ) : (
                  data.leave.items.map(item => (
                    <SectionCard
                      key={item.leaveId}
                      title={`${label(item.leaveType)} · ${item.startDate} to ${
                        item.endDate
                      }`}
                    >
                      <Badge status={item.status} />
                      <Text style={styles.body}>{item.reason}</Text>
                      {item.history.map((h, index) => (
                        <Text key={index} style={styles.muted}>
                          {label(h.action)} ·{' '}
                          {new Date(h.createdAt).toLocaleString()}
                        </Text>
                      ))}
                    </SectionCard>
                  ))
                )}
                <Text style={styles.muted}>
                  Leave decisions follow the school approval process. Contact
                  your reviewer for changes; online cancellation is not
                  supported.
                </Text>
              </SectionCard>
            </>
          ) : null}
          {tab === 'Payslips' ? (
            <SectionCard title="Approved payslips">
              {!data.payslips.items.length ? (
                <Text style={styles.body}>
                  No approved payslips available. The school office must release
                  your payroll document.
                </Text>
              ) : (
                data.payslips.items
                  .filter(p => p.status === 'approved')
                  .map(p => (
                    <SectionCard key={p.payslipId} title={p.period}>
                      <Badge status={p.status} />
                      {p.netAmount !== null && p.currency ? (
                        <Text style={styles.body}>
                          Net amount: {p.currency}{' '}
                          {p.netAmount.toLocaleString()}
                        </Text>
                      ) : null}
                      <Text style={styles.muted}>
                        Approved {new Date(p.approvedAt).toLocaleDateString()}
                      </Text>
                      {p.canDownload ? (
                        <Button
                          title={`Open payslip ${p.period}`}
                          disabled={action.pending}
                          onPress={() =>
                            action.run(
                              () => openFile('payslips', p.payslipId),
                              'File viewer opened.',
                            )
                          }
                        />
                      ) : (
                        <Text style={styles.muted}>
                          No generated file has been attached by payroll.
                        </Text>
                      )}
                    </SectionCard>
                  ))
              )}
              {!staffFilesSupported() ? (
                <Text style={styles.muted}>
                  Secure file opening requires a supported device build. Contact
                  the school office if unavailable.
                </Text>
              ) : null}
            </SectionCard>
          ) : null}
          {tab === 'Documents' ? (
            <SectionCard title="Your documents">
              {!data.documents.items.length ? (
                <Text style={styles.body}>
                  No staff documents have been shared with you.
                </Text>
              ) : (
                data.documents.items.map(d => (
                  <SectionCard key={d.documentId} title={d.title}>
                    <Badge status={d.status} />
                    <Text style={styles.body}>{d.documentType}</Text>
                    <Text style={styles.muted}>
                      {d.expiresOn
                        ? `Expires ${d.expiresOn}`
                        : 'No expiry recorded'}
                    </Text>
                    {d.canDownload ? (
                      <Button
                        title={`Open ${d.title}`}
                        disabled={action.pending}
                        onPress={() =>
                          action.run(
                            () => openFile('documents', d.documentId),
                            'File viewer opened.',
                          )
                        }
                      />
                    ) : (
                      <Text style={styles.muted}>No file attached.</Text>
                    )}
                  </SectionCard>
                ))
              )}
              <Text style={styles.muted}>
                Documents expiring within 30 calendar days are marked expiring
                soon.
              </Text>
            </SectionCard>
          ) : null}
          {tab === 'PTM / Appointments' ? (
            <SectionCard title="Slots & meetings">
              <Text style={styles.muted}>
                School time: {data.appointments.timezone}. PTM meetings use your
                currently assigned students. Parent self-booking is not
                available.
              </Text>
              {canManage ? (
                <Button
                  title="Offer Slot"
                  onPress={() => open('slot')}
                  disabled={action.pending}
                />
              ) : null}
              {!data.appointments.items.length ? (
                <Text style={styles.body}>
                  No offered slots or meetings yet.
                </Text>
              ) : (
                data.appointments.items.map(item => (
                  <SectionCard key={item.appointmentId} title={item.title}>
                    <Badge status={item.status} />
                    <Text style={styles.body}>
                      {item.date} · {item.startTime}–{item.endTime}
                    </Text>
                    {item.studentName ? (
                      <Text style={styles.body}>
                        {item.studentName} · {item.context}
                      </Text>
                    ) : null}
                    <Button
                      title={`Meeting history: ${item.title}`}
                      variant="secondary"
                      onPress={() => setDetail(item)}
                    />
                    {canManage &&
                    ['available', 'confirmed'].includes(item.status) ? (
                      <>
                        {item.status === 'available' ? (
                          <Button
                            title={`Confirm: ${item.title}`}
                            disabled={action.pending}
                            onPress={() => open('confirm', item)}
                          />
                        ) : null}
                        <Button
                          title={`Reschedule: ${item.title}`}
                          disabled={action.pending}
                          variant="secondary"
                          onPress={() => open('reschedule', item)}
                        />
                        <Button
                          title={`Cancel: ${item.title}`}
                          disabled={action.pending}
                          variant="danger"
                          onPress={() => open('cancel', item)}
                        />
                        {item.status === 'confirmed' ? (
                          <Button
                            title={`Complete: ${item.title}`}
                            disabled={action.pending}
                            variant="secondary"
                            onPress={() => open('complete', item)}
                          />
                        ) : null}
                      </>
                    ) : null}
                  </SectionCard>
                ))
              )}
            </SectionCard>
          ) : null}
        </>
      ) : null}
      <AdminDialog
        visible={!!dialog && !!data}
        title={dialogTitle}
        confirmTitle={dialogTitle}
        busy={action.pending}
        busyLabel="Waiting for school confirmation"
        onClose={() => {
          setDialog(null);
          studentGeneration.current++;
        }}
        onConfirm={submit}
        danger={dialog === 'cancel'}
      >
        {validation ? (
          <Text accessibilityRole="alert" style={styles.body}>
            {validation}
          </Text>
        ) : null}
        {action.error ? (
          <Text accessibilityRole="alert" style={styles.body}>
            {action.error}
          </Text>
        ) : null}
        {dialog === 'leave' ? (
          <>
            <AdminSelect
              label="Leave type"
              value={leaveType}
              options={['personal', 'sick', 'unpaid'].map(id => ({
                id,
                label: label(id),
              }))}
              placeholder="Choose leave type"
              helper="Requests require school approval."
              onSelect={setLeaveType}
              disabled={action.pending}
            />
            <AdminDateField
              label="Leave start date"
              value={startDate}
              onChange={setStartDate}
              helper="First calendar day of leave"
              disabled={action.pending}
            />
            <AdminDateField
              label="Leave end date"
              value={endDate}
              onChange={setEndDate}
              helper="Last calendar day of leave"
              disabled={action.pending}
            />
            <Text style={formStyles.label}>Reason</Text>
            <TextInput
              accessibilityLabel="Leave reason"
              value={reason}
              onChangeText={setReason}
              multiline
              maxLength={350}
              editable={!action.pending}
              style={formStyles.input}
            />
          </>
        ) : null}
        {dialog === 'slot' || dialog === 'reschedule' ? (
          <>
            {dialog === 'slot' ? (
              <>
                <Text style={formStyles.label}>Meeting title</Text>
                <TextInput
                  accessibilityLabel="Meeting title"
                  value={title}
                  onChangeText={setTitle}
                  maxLength={120}
                  editable={!action.pending}
                  style={formStyles.input}
                />
              </>
            ) : (
              <Text style={styles.body}>
                Current time: {selected?.date} {selected?.startTime}–
                {selected?.endTime}. The original time remains in history.
              </Text>
            )}
            <AdminDateField
              label="Meeting date"
              value={date}
              onChange={setDate}
              helper="School-local date"
              disabled={action.pending}
            />
            <Text style={formStyles.label}>Start time (HH:mm)</Text>
            <TextInput
              accessibilityLabel="Meeting start time"
              placeholder="HH:mm"
              value={startTime}
              onChangeText={setStartTime}
              editable={!action.pending}
              style={formStyles.input}
            />
            <Text style={formStyles.label}>End time (HH:mm)</Text>
            <TextInput
              accessibilityLabel="Meeting end time"
              placeholder="HH:mm"
              value={endTime}
              onChangeText={setEndTime}
              editable={!action.pending}
              style={formStyles.input}
            />
          </>
        ) : null}
        {dialog === 'confirm' ? (
          <>
            <Text style={styles.body}>
              Confirm {selected?.title} at {selected?.startTime} on{' '}
              {selected?.date}. Choose a learner for a PTM, or leave blank for a
              staff meeting.
            </Text>
            <AdminSelect
              label="PTM student"
              value={student}
              options={students.map((s, index) => ({
                id: String(index),
                label: s.fullName,
                detail: s.context,
              }))}
              placeholder="Staff meeting (no learner)"
              helper="Only your assigned roster is available."
              loading={studentLoading}
              disabled={action.pending || !!studentError}
              onSelect={setStudent}
            />
            {student ? (
              <Button
                title="Use staff meeting instead"
                variant="secondary"
                onPress={() => setStudent('')}
              />
            ) : null}
            {studentError ? (
              <>
                <Text accessibilityRole="alert" style={styles.body}>
                  {studentError}
                </Text>
                <Button title="Retry students" onPress={loadStudents} />
              </>
            ) : null}
          </>
        ) : null}
        {dialog === 'cancel' || dialog === 'complete' ? (
          <Text style={styles.body}>
            {dialog === 'cancel'
              ? 'Cancel this slot or meeting? Its previous times and status remain in history.'
              : 'Mark this finished meeting completed?'}{' '}
            {selected?.title} · {selected?.date} {selected?.startTime}–
            {selected?.endTime}
          </Text>
        ) : null}
      </AdminDialog>
      <AdminDialog
        visible={!!detail && !!data}
        title="Meeting history"
        onClose={() => setDetail(null)}
      >
        {detail?.history.map((h, index) => (
          <Text key={index} style={styles.body}>
            {label(h.action)} · {h.date} {h.startTime}–{h.endTime}
          </Text>
        ))}
      </AdminDialog>
    </DashboardShell>
  );
}
