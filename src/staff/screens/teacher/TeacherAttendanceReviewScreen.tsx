import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Text, TextInput } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { TeacherStackParamList } from '../../navigation/TeacherNavigator';
import { useAuth } from '../../context/AuthContext';
import {
  Button,
  ScreenHeading,
  SectionCard,
} from '../../components/hiraDashboard';
import {
  AdminSelect,
  AdminDateField,
  AdminDialog,
  AdminFeedback,
  formStyles,
} from '../../components/hiraDashboard/AdminForm';
import {
  DashboardShell,
  DashboardStateCard,
} from '../../components/hiraDashboard/DashboardShell';
import { colors } from '../../theme/hiraDashboard';
import { amendmentService } from '../../services/teacher/amendmentService';
import { attendanceOperationId } from '../../services/teacher/attendanceService';
import { ApiError } from '../../services/api/apiClient';
import { useTeacherResource } from './useTeacherResource';
import { PeriodSummary } from './timetableUi';
import { AmendmentHistoryCard } from './AttendanceAmendmentUi';
export const amendmentError = (e: unknown) =>
  e instanceof ApiError
    ? e.status === 403
      ? 'Your permission changed. You may no longer be authorized for this occurrence.'
      : e.status === 404
      ? 'The attendance, student or occurrence is unavailable.'
      : e.status === 409
      ? 'Attendance or this request changed. Review refreshed history before retrying.'
      : e.message
    : e instanceof Error
    ? e.message
    : 'Unable to save. Your entries are retained; please retry.';
const validDate = (value: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value + 'T00:00:00Z')) &&
  new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
export default function TeacherAttendanceReviewScreen({
  route,
}: NativeStackScreenProps<TeacherStackParamList, 'TeacherAttendanceReview'>) {
  const { sessionId, studentId } = route.params,
    { accessToken } = useAuth();
  const [offset, setOffset] = useState(0),
    [mode, setMode] = useState<'correction' | 'leave'>('correction'),
    [status, setStatus] = useState(''),
    [reason, setReason] = useState(''),
    [from, setFrom] = useState(''),
    [until, setUntil] = useState(''),
    [category, setCategory] = useState('illness'),
    [confirm, setConfirm] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [success, setSuccess] = useState('');
  const epoch = useRef(0),
    live = useRef(true),
    inFlight = useRef(false),
    operation = useRef<{ key: string; id: string } | null>(null);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  useEffect(() => {
    epoch.current += 1;
    inFlight.current = false;
    setBusy(false);
    setStatus('');
    setReason('');
    setFrom('');
    setUntil('');
    setConfirm(false);
    setError('');
    setSuccess('');
    setOffset(0);
    operation.current = null;
  }, [sessionId, studentId, accessToken]);
  const load = useCallback(() => {
    if (!accessToken) throw new Error('Sign in again to review attendance.');
    return amendmentService.context(accessToken, sessionId, studentId, offset);
  }, [accessToken, sessionId, studentId, offset]);
  const resource = useTeacherResource(
      load,
      'This attendance context is no longer available.',
    ),
    data = resource.data;
  const canSubmit =
    !!data &&
    !busy &&
    !resource.loading &&
    reason.trim().length >= 10 &&
    reason.trim().length <= 500 &&
    (mode === 'correction'
      ? data.canRequestCorrection &&
        !!status &&
        status !== data.effective?.status &&
        (status !== 'leave' || !!data.approvedLeaveId)
      : data.canRequestLeave &&
        validDate(from) &&
        validDate(until) &&
        from <= data.period.date &&
        until >= data.period.date &&
        until >= from);
  const save = async () => {
    if (inFlight.current || !data || !accessToken || !canSubmit) return;
    inFlight.current = true;
    const requestEpoch = epoch.current;
    setBusy(true);
    setError('');
    const body =
      mode === 'correction'
        ? {
            requestedStatus: status,
            reason: reason.trim(),
            submittedRevision: data.submittedRevision,
            effectiveRevision: data.effective!.effectiveRevision,
            ...(status === 'leave' ? { leaveId: data.approvedLeaveId } : {}),
          }
        : { fromDate: from, untilDate: until, category, reason: reason.trim() };
    const key = JSON.stringify({ sessionId, studentId, mode, body });
    if (operation.current?.key !== key)
      operation.current = { key, id: attendanceOperationId() };
    try {
      const result = await amendmentService.create(
        accessToken,
        sessionId,
        studentId,
        mode,
        { ...body, clientOperationId: operation.current.id },
      );
      if (!live.current || requestEpoch !== epoch.current) return;
      setSuccess(
        result.state === 'pending'
          ? mode === 'correction'
            ? 'Correction request submitted.'
            : 'Student leave request submitted.'
          : 'This request has already been reviewed.',
      );
      setConfirm(false);
      await resource.refresh();
    } catch (e) {
      if (live.current && requestEpoch === epoch.current) {
        setConfirm(false);
        setError(amendmentError(e));
        if (e instanceof ApiError && [401, 403, 404, 409].includes(e.status))
          await resource.refresh();
      }
    } finally {
      if (requestEpoch === epoch.current) {
        inFlight.current = false;
        if (live.current) setBusy(false);
      }
    }
  };
  return (
    <DashboardShell
      safeArea={false}
      refreshing={resource.loading}
      onRefresh={resource.refresh}
    >
      <ScreenHeading
        title="Attendance review"
        subtitle="Student leave, submitted history and controlled corrections"
      />
      <DashboardStateCard
        loading={resource.loading}
        error={resource.error}
        onRetry={resource.refresh}
      />
      {error ? (
        <AdminFeedback
          kind="error"
          title="Request not submitted"
          message={error}
        />
      ) : null}
      {success ? (
        <AdminFeedback
          kind="success"
          title={success}
          message="Submitted attendance is preserved. Its effective status changes only after an approved correction. Approved leave does not rewrite attendance."
        />
      ) : null}
      {data ? (
        <>
          <SectionCard title="Teacher and attendance context">
            <Text style={formStyles.heading}>{data.teacherName}</Text>
            <PeriodSummary period={data.period} />
            <Text style={formStyles.label}>{data.student.fullName}</Text>
            <Text style={formStyles.copy}>
              Admission number: {data.student.admissionNumber}
            </Text>
            <Text style={formStyles.copy}>
              Original submitted status:{' '}
              {data.effective?.originalStatus ?? 'Not submitted'}
            </Text>
            <Text style={formStyles.copy}>
              Effective status: {data.effective?.status ?? 'Not submitted'}
            </Text>
          </SectionCard>
          {data.canRequestCorrection ? (
            <Button
              title="Request Correction"
              variant="secondary"
              disabled={busy}
              onPress={() => {
                setMode('correction');
                setError('');
                setSuccess('');
              }}
            />
          ) : null}
          {data.canRequestLeave ? (
            <Button
              title="Request Student Leave"
              variant="secondary"
              disabled={busy}
              onPress={() => {
                setMode('leave');
                setFrom(data.period.date);
                setUntil(data.period.date);
                setError('');
                setSuccess('');
              }}
            />
          ) : null}
          {(
            mode === 'correction'
              ? data.canRequestCorrection
              : data.canRequestLeave
          ) ? (
            <SectionCard
              title={
                mode === 'correction'
                  ? 'Request attendance correction'
                  : 'Request student leave'
              }
            >
              {mode === 'correction' ? (
                <>
                  <AdminSelect
                    label="Requested status"
                    value={status}
                    options={['present', 'absent', 'late', 'leave'].map(id => ({
                      id,
                      label: id,
                    }))}
                    placeholder="Choose a corrected status"
                    helper="Choose a different status. Leave requires an approved student-leave record covering this date."
                    disabled={busy}
                    onSelect={setStatus}
                  />
                  {status === 'leave' && !data.approvedLeaveId ? (
                    <Text style={formStyles.helper}>
                      Request student leave first and return after approval.
                    </Text>
                  ) : null}
                </>
              ) : (
                <>
                  <AdminDateField
                    label="Leave from"
                    value={from}
                    onChange={setFrom}
                    helper="School date, YYYY-MM-DD. Include the selected attendance date."
                    disabled={busy}
                  />
                  <AdminDateField
                    label="Leave until"
                    value={until}
                    onChange={setUntil}
                    helper="Inclusive final school date."
                    disabled={busy}
                  />
                  <AdminSelect
                    label="Leave category"
                    value={category}
                    options={[
                      { id: 'illness', label: 'Illness' },
                      { id: 'authorized_absence', label: 'Authorized absence' },
                      { id: 'other', label: 'Other' },
                    ]}
                    placeholder="Choose a leave category"
                    helper="The Principal reviews this leave request."
                    disabled={busy}
                    onSelect={setCategory}
                  />
                </>
              )}
              <Text style={formStyles.label}>Reason</Text>
              <TextInput
                accessibilityLabel="Reason"
                value={reason}
                onChangeText={setReason}
                placeholder="Explain the leave or correction"
                placeholderTextColor={colors.muted}
                multiline
                maxLength={500}
                editable={!busy}
                style={formStyles.input}
              />
              <Text style={formStyles.helper}>
                10–500 characters. Explain the facts without private medical or
                guardian details.
              </Text>
              <Button
                title={
                  mode === 'correction'
                    ? 'Review Correction Request'
                    : 'Review Leave Request'
                }
                disabled={!canSubmit}
                onPress={() => setConfirm(true)}
              />
            </SectionCard>
          ) : null}
          <SectionCard title="Correction history">
            <Text style={formStyles.helper}>
              Original submission is immutable. Showing{' '}
              {data.corrections.length} of {data.total} requests.
            </Text>
            {data.corrections.map(item => (
              <AmendmentHistoryCard key={item.requestId} item={item} />
            ))}
            {!data.corrections.length ? (
              <Text style={formStyles.copy}>
                No correction requests for this student.
              </Text>
            ) : null}
            {data.nextOffset !== null ? (
              <Button
                title="Next correction history"
                onPress={() => setOffset(data.nextOffset!)}
              />
            ) : null}
            {offset > 0 ? (
              <Button
                title="First correction history"
                onPress={() => setOffset(0)}
              />
            ) : null}
          </SectionCard>
          <SectionCard title="Student leave history">
            {data.leaves.map(item => (
              <AmendmentHistoryCard key={item.requestId} item={item} />
            ))}
            {!data.leaves.length ? (
              <Text style={formStyles.copy}>
                No leave requests covering this attendance date.
              </Text>
            ) : null}
          </SectionCard>
        </>
      ) : null}
      <AdminDialog
        visible={confirm && !!data}
        title={
          mode === 'correction'
            ? 'Request attendance correction?'
            : 'Request student leave?'
        }
        onClose={() => {
          if (!busy) setConfirm(false);
        }}
        onConfirm={save}
        confirmTitle={
          mode === 'correction' ? 'Submit Correction' : 'Submit Leave Request'
        }
        busy={busy}
        busyLabel="Submitting attendance request"
      >
        <Text style={formStyles.label}>{data?.student.fullName}</Text>
        <Text style={formStyles.copy}>
          {mode === 'correction'
            ? `Current: ${data?.effective?.status}\nRequested: ${status}`
            : `Leave: ${from} to ${until}`}
          {'\n'}Reason: {reason}
        </Text>
      </AdminDialog>
    </DashboardShell>
  );
}
