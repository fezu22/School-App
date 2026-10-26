import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Text, TextInput } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { PrincipalStackParamList } from '../../navigation/PrincipalNavigator';
import { useAuth } from '../../context/AuthContext';
import {
  Button,
  ScreenHeading,
  SectionCard,
} from '../../components/hiraDashboard';
import {
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
import { useTeacherResource } from '../teacher/useTeacherResource';
import { PeriodSummary } from '../teacher/timetableUi';
import { AmendmentHistoryCard } from '../teacher/AttendanceAmendmentUi';
import { amendmentError } from '../teacher/TeacherAttendanceReviewScreen';
export default function PrincipalAttendanceReviewScreen({
  route,
}: NativeStackScreenProps<PrincipalStackParamList, 'AttendanceReview'>) {
  const { approvalId } = route.params,
    { accessToken } = useAuth(),
    [note, setNote] = useState(''),
    [decision, setDecision] = useState<'approved' | 'rejected' | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [success, setSuccess] = useState('');
  const epoch = useRef(0),
    live = useRef(true),
    pending = useRef(false),
    operation = useRef<{ key: string; id: string } | null>(null);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  useEffect(() => {
    epoch.current += 1;
    pending.current = false;
    setBusy(false);
    setNote('');
    setDecision(null);
    setError('');
    setSuccess('');
    operation.current = null;
  }, [approvalId, accessToken]);
  const load = useCallback(() => {
    if (!accessToken) throw new Error('Sign in again to review attendance.');
    return amendmentService.review(accessToken, approvalId);
  }, [accessToken, approvalId]);
  const resource = useTeacherResource(
      load,
      'This request is unavailable or outside your authorized branch.',
    ),
    data = resource.data;
  const save = async () => {
    if (
      pending.current ||
      !accessToken ||
      !data?.canReview ||
      !decision ||
      (decision === 'rejected' && note.trim().length < 10)
    )
      return;
    pending.current = true;
    const requestEpoch = epoch.current;
    setBusy(true);
    setError('');
    const body = {
      action: decision,
      reviewNote: note.trim(),
      revision: data.request.revision,
    };
    const key = JSON.stringify({ approvalId, body });
    if (operation.current?.key !== key)
      operation.current = { key, id: attendanceOperationId() };
    try {
      const result = await amendmentService.decide(accessToken, approvalId, {
        ...body,
        clientOperationId: operation.current.id,
      });
      if (!live.current || requestEpoch !== epoch.current) return;
      if (result.state !== decision)
        throw new Error(
          'The server did not confirm this decision. Refresh before retrying.',
        );
      setSuccess(
        decision === 'approved' ? 'Request approved.' : 'Request rejected.',
      );
      setDecision(null);
      await resource.refresh();
    } catch (e) {
      if (live.current && requestEpoch === epoch.current) {
        setDecision(null);
        setError(amendmentError(e));
        await resource.refresh();
      }
    } finally {
      if (requestEpoch === epoch.current) {
        pending.current = false;
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
        title="Attendance and leave review"
        subtitle="Principal · your authorized branch"
      />
      <DashboardStateCard
        loading={resource.loading}
        error={resource.error}
        onRetry={resource.refresh}
      />
      {error ? (
        <AdminFeedback
          kind="error"
          title="Decision not confirmed"
          message={error}
        />
      ) : null}
      {success ? (
        <AdminFeedback
          kind="success"
          title={success}
          message="Decision and audit history were saved. Original submitted attendance remains preserved."
        />
      ) : null}
      {data ? (
        <>
          <SectionCard title="Student and occurrence">
            <PeriodSummary period={data.period} />
            <Text style={formStyles.heading}>{data.student.fullName}</Text>
            <Text style={formStyles.copy}>
              Admission number: {data.student.admissionNumber}
            </Text>
            <Text style={formStyles.copy}>
              Original: {data.effective?.originalStatus ?? 'Not submitted'} ·
              Effective: {data.effective?.status ?? 'Not submitted'}
            </Text>
          </SectionCard>
          <SectionCard
            title={
              data.kind === 'correction'
                ? 'Correction request'
                : 'Student leave request'
            }
          >
            <AmendmentHistoryCard item={data.request} />
          </SectionCard>
          {data.canReview ? (
            <SectionCard title="Review decision">
              <Text style={formStyles.label}>Review note</Text>
              <TextInput
                accessibilityLabel="Review note"
                value={note}
                onChangeText={setNote}
                placeholder="Explain your decision"
                placeholderTextColor={colors.muted}
                multiline
                maxLength={500}
                editable={!busy}
                style={formStyles.input}
              />
              <Text style={formStyles.helper}>
                Rejection requires 10–500 characters. Approval note is optional.
              </Text>
              <Button
                title="Approve"
                disabled={busy}
                onPress={() => setDecision('approved')}
              />
              <Button
                title="Reject"
                variant="danger"
                disabled={busy || note.trim().length < 10}
                onPress={() => setDecision('rejected')}
              />
            </SectionCard>
          ) : null}
        </>
      ) : null}
      <AdminDialog
        visible={!!decision && !!data}
        title={
          decision === 'approved'
            ? 'Approve this request?'
            : 'Reject this request?'
        }
        onClose={() => {
          if (!busy) setDecision(null);
        }}
        onConfirm={save}
        confirmTitle={
          decision === 'approved' ? 'Confirm Approval' : 'Confirm Rejection'
        }
        busy={busy}
        busyLabel="Saving review decision"
        danger={decision === 'rejected'}
      >
        <Text style={formStyles.label}>{data?.student.fullName}</Text>
        <Text style={formStyles.copy}>
          Current: {data?.effective?.status ?? 'Not submitted'} · Requested:{' '}
          {data?.request.requestedStatus ?? 'Student leave'}
          {'\n'}Reason: {data?.request.reason}
          {'\n'}Review note: {note || 'No additional note'}
        </Text>
      </AdminDialog>
    </DashboardShell>
  );
}
