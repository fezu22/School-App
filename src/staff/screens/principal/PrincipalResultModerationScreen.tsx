import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Text, TextInput } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { PrincipalStackParamList } from '../../navigation/PrincipalNavigator';
import { useAuth } from '../../context/AuthContext';
import {
  AdminDialog,
  AdminFeedback,
  formStyles,
} from '../../components/hiraDashboard/AdminForm';
import {
  Button,
  DashboardShell,
  ScreenHeading,
  SectionCard,
  StatusBadge,
} from '../../components/hiraDashboard';
import { ApiError } from '../../services/api/apiClient';
import { resultModerationService } from '../../services/principal/resultModerationService';
import { resultOperationId } from '../../services/teacher/resultService';
import { useTeacherResource } from '../teacher/useTeacherResource';
import { styles } from '../teacher/teacherUi';

export default function PrincipalResultModerationScreen({
  route,
}: NativeStackScreenProps<PrincipalStackParamList, 'ResultModeration'>) {
  const { accessToken, user } = useAuth();
  // A changed record or authenticated actor gets a fresh resource and form.
  return (
    <ResultDetail
      key={JSON.stringify([route.params.approvalId, accessToken, user])}
      approvalId={route.params.approvalId}
      token={accessToken}
    />
  );
}
function ResultDetail({
  approvalId,
  token,
}: {
  approvalId: string;
  token: string | null;
}) {
  const load = useCallback(async () => {
    if (!token)
      throw new Error('Your session is unavailable. Please sign in again.');
    try {
      return await resultModerationService.detail(token, approvalId);
    } catch (error) {
      if (error instanceof ApiError && [401, 403].includes(error.status))
        throw new Error(
          'You no longer have permission to view or change this result.',
        );
      throw error;
    }
  }, [token, approvalId]);
  // Server resource is the ONLY full record owner. Mutation DTOs are never
  // duplicated in local state. Every mutation (including failure) revalidates it.
  const resource = useTeacherResource(
    load,
    'This result is unavailable or outside your Branch.',
  );
  const [reason, setReason] = useState(''),
    [busy, setBusy] = useState(false),
    [confirming, setConfirming] = useState(false);
  const [notice, setNotice] = useState<{
    kind: 'success' | 'error';
    title: string;
    message: string;
  } | null>(null);
  const lock = useRef(false),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const detail = resource.data,
    result = detail?.result,
    revision = result?.revisions.find(
      v => v.revision === result.currentRevision,
    );
  useEffect(() => {
    setReason('');
    setConfirming(false);
  }, [detail]);
  const act = async (action: 'approve' | 'return' | 'reject' | 'publish') => {
    if (
      !token ||
      !detail ||
      lock.current ||
      resource.loading ||
      (action === 'publish' ? !detail.canPublish : !detail.canModerate)
    )
      return;
    if (
      (action === 'return' || action === 'reject') &&
      reason.trim().length < 3
    ) {
      setNotice({
        kind: 'error',
        title: 'Reason Required',
        message:
          'Enter a reason of at least three characters before returning or rejecting this result.',
      });
      return;
    }
    lock.current = true;
    setBusy(true);
    setNotice(null);
    setConfirming(false);
    let feedback: NonNullable<typeof notice>;
    try {
      const body = {
        recordRevision: detail.result.recordRevision,
        clientOperationId: resultOperationId(action),
        ...(action === 'publish' ? {} : { action, reason }),
      };
      if (action === 'publish')
        await resultModerationService.publish(token, approvalId, body);
      else await resultModerationService.moderate(token, approvalId, body);
      feedback = {
        kind: 'success',
        title:
          action === 'publish' ? 'Result Published' : 'Moderation Recorded',
        message:
          action === 'publish'
            ? 'The result is now available to eligible Students.'
            : 'The moderation decision was recorded without publishing.',
      };
    } catch (error) {
      feedback =
        error instanceof ApiError && error.status === 409
          ? {
              kind: 'error',
              title: 'Result Updated',
              message:
                'This result changed while you were viewing it. Review the latest version before continuing.',
            }
          : error instanceof ApiError && [401, 403, 404].includes(error.status)
          ? {
              kind: 'error',
              title: 'Action Not Available',
              message:
                'Your account no longer has permission to change this result, or it is outside your Branch.',
            }
          : {
              kind: 'error',
              title: 'Action Not Confirmed',
              message:
                'Unable to confirm this action. Refresh the result before trying again.',
            };
    }
    if (mounted.current) {
      await resource.refresh();
      if (mounted.current) {
        setNotice(feedback);
        setBusy(false);
      }
    }
    lock.current = false;
  };
  return (
    <DashboardShell
      refreshing={resource.loading}
      onRefresh={resource.refresh}
      keyboardShouldPersistTaps="handled"
    >
      <ScreenHeading
        title="Result Review"
        subtitle="Approval and publication are separate controlled actions"
      />
      {resource.loading ? (
        <Text style={styles.body}>Loading result...</Text>
      ) : resource.error ? (
        <AdminFeedback
          kind="error"
          title="Unable to Load Result"
          message={resource.error}
        />
      ) : null}
      {resource.error ? (
        <Button title="Retry" variant="secondary" onPress={resource.refresh} />
      ) : null}
      {notice ? <AdminFeedback {...notice} /> : null}
      {detail && result && revision ? (
        <>
          {detail.configurationIssue ? (
            <AdminFeedback
              kind="error"
              title="Academic Configuration"
              message={detail.configurationIssue}
            />
          ) : null}
          <SectionCard title="Academic Context">
            <Text style={styles.body}>
              {result.academic.className} / {result.academic.sectionName} -{' '}
              {result.academic.subjectName}
            </Text>
            <Text style={styles.muted}>
              Academic year: {result.academic.academicYear}
            </Text>
            <Text style={styles.muted}>
              Teacher: {detail.teacherName || 'Unavailable'}
            </Text>
          </SectionCard>
          <SectionCard title="Assessment Source">
            <Text style={styles.body}>
              {result.assessmentTitle} - Frozen review {revision.sourceScore}/
              {revision.sourceMax}
            </Text>
          </SectionCard>
          <SectionCard title="Student">
            <Text style={styles.body}>
              {result.student.fullName} - {result.student.admissionNumber}
            </Text>
          </SectionCard>
          <SectionCard title="Result">
            <StatusBadge
              status={
                result.status === 'published'
                  ? 'paid'
                  : result.status === 'rejected'
                  ? 'unpaid'
                  : 'pending'
              }
              label={
                result.status === 'published'
                  ? 'Published'
                  : result.status === 'moderated_approved'
                  ? 'Approved'
                  : result.status === 'returned_for_revision'
                  ? 'Returned'
                  : result.status === 'rejected'
                  ? 'Rejected'
                  : 'In review'
              }
            />
            <Text style={styles.body}>
              {result.status.replaceAll('_', ' ')}
            </Text>
            <Text style={styles.body}>
              {revision.awardedMarks} / {revision.maxMarks}
            </Text>
            <Text style={styles.muted}>
              Approval: {detail.approvalStatus.replaceAll('_', ' ')}
            </Text>
            <Text style={styles.muted}>
              {result.publishedAt
                ? 'Published: ' +
                  new Date(result.publishedAt).toLocaleString('en-PK')
                : 'Unpublished: not visible to Students'}
            </Text>
            {revision.overrideReason ? (
              <Text style={styles.muted}>
                Override: {revision.overrideReason}
              </Text>
            ) : null}
          </SectionCard>
          <SectionCard title="Revision History">
            {result.revisions.map(v => (
              <Text key={v.revision} style={styles.muted}>
                Revision {v.revision}: {v.awardedMarks}/{v.maxMarks} (source{' '}
                {v.sourceScore}/{v.sourceMax})
              </Text>
            ))}
          </SectionCard>
          <SectionCard title="Result History">
            {result.history.map((event, index) => (
              <Text key={index} style={styles.muted}>
                {event.action.replaceAll('_', ' ')} · Revision{' '}
                {event.resultRevision} · {event.actorRole}
                {event.reason ? ' · ' + event.reason : ''}
              </Text>
            ))}
            {result.moderationHistory.map((event, index) => (
              <Text key={'moderation-' + index} style={styles.muted}>
                {event.action}: {event.note || 'No additional feedback'}
              </Text>
            ))}
          </SectionCard>
          {!busy && detail.canModerate ? (
            <SectionCard title="Moderation Decision">
              <TextInput
                accessibilityLabel="Moderation reason"
                placeholder="Reason or feedback"
                value={reason}
                onChangeText={setReason}
                multiline
                style={formStyles.input}
              />
              <Text style={styles.muted}>
                A reason is required for returns and rejections.
              </Text>
              <Button title="Approve" onPress={() => act('approve')} />
              <Button
                title="Return for Changes"
                variant="secondary"
                onPress={() => act('return')}
              />
              <Button
                title="Reject"
                variant="danger"
                onPress={() => act('reject')}
              />
            </SectionCard>
          ) : null}
          {!busy && !confirming && detail.canPublish ? (
            <SectionCard title="Awaiting Publication">
              <Text style={styles.body}>
                This result is approved and unpublished. Publish it when your
                review is complete.
              </Text>
              <Button
                title="Publish Result"
                onPress={() => setConfirming(true)}
              />
            </SectionCard>
          ) : null}
        </>
      ) : null}
      {busy ? <Text style={styles.body}>Updating result...</Text> : null}
      {confirming && detail?.canPublish && !resource.loading && !busy ? (
        <AdminDialog
          visible
          title="Publish Result?"
          confirmTitle="Publish Result"
          busyLabel="Publishing result"
          onClose={() => setConfirming(false)}
          onConfirm={() => act('publish')}
        >
          <Text style={styles.body}>
            This result will become visible to eligible Students.
          </Text>
          <Text style={styles.muted}>
            Class: {result?.academic.className} · Section:{' '}
            {result?.academic.sectionName}
          </Text>
          <Text style={styles.muted}>
            Subject: {result?.academic.subjectName}
          </Text>
        </AdminDialog>
      ) : null}
    </DashboardShell>
  );
}
