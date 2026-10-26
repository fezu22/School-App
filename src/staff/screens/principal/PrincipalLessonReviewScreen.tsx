import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Text, TextInput } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { PrincipalStackParamList } from '../../navigation/PrincipalNavigator';
import { useAuth } from '../../context/AuthContext';
import {
  Button,
  DashboardShell,
  ScreenHeading,
  SectionCard,
  StatusBadge,
} from '../../components/hiraDashboard';
import {
  AdminDialog,
  AdminFeedback,
  formStyles,
} from '../../components/hiraDashboard/AdminForm';
import SyllabusCoverage from '../../components/academic/SyllabusCoverage';
import {
  academicOperationId,
  lessonReviewService,
  type LessonReviewContext,
} from '../../services/teacher/academicService';
import { useTeacherResource } from '../teacher/useTeacherResource';
import { LoadState } from '../teacher/teacherUi';
import { ApiError } from '../../services/api/apiClient';

type Action = 'approved' | 'needs_revision' | 'rejected';
export default function PrincipalLessonReviewScreen({
  route,
  navigation,
}: NativeStackScreenProps<PrincipalStackParamList, 'ApprovalDetail'>) {
  const { accessToken } = useAuth();
  const load = useCallback(() => {
    if (!accessToken)
      return Promise.reject(new Error('Authentication required'));
    return lessonReviewService.detail(accessToken, route.params.request._id);
  }, [accessToken, route.params.request._id]);
  const resource = useTeacherResource(load);
  const [confirmed, setConfirmed] = useState<LessonReviewContext | null>(null);
  useEffect(() => {
    setConfirmed(null);
  }, [resource.data]);
  const data =
    resource.loading || resource.error ? null : confirmed ?? resource.data;
  const [note, setNote] = useState(''),
    [action, setAction] = useState<Action | null>(null),
    [busy, setBusy] = useState(false),
    [conflict, setConflict] = useState(false);
  const [feedback, setFeedback] = useState<{
    kind: 'success' | 'error';
    title: string;
    message: string;
  } | null>(null);
  const lock = useRef(false),
    pending = useRef<{ key: string; id: string } | null>(null);
  const decide = async () => {
    if (
      lock.current ||
      busy ||
      conflict ||
      !action ||
      !accessToken ||
      !data?.canReview
    )
      return;
    lock.current = true;
    setBusy(true);
    setFeedback(null);
    const body = { action, reviewNote: note, revision: data.submittedRevision };
    const key = JSON.stringify(body);
    if (pending.current?.key !== key)
      pending.current = { key, id: academicOperationId() };
    try {
      const response = await lessonReviewService.decide(
        accessToken,
        data.approvalId,
        { ...body, clientOperationId: pending.current.id },
      );
      setConfirmed(response);
      setAction(null);
      pending.current = null;
      setFeedback({
        kind: 'success',
        title: 'Lesson review recorded',
        message:
          'This decision does not record delivery. Coverage changes only from explicit Teacher evidence.',
      });
    } catch (e) {
      const stale = e instanceof ApiError && e.status === 409;
      if (stale) {
        setConflict(true);
        setAction(null);
      }
      setFeedback({
        kind: 'error',
        title: stale ? 'Review revision conflict' : 'Unable to review lesson',
        message: `${
          e instanceof Error ? e.message : 'Please retry.'
        } Your note has been retained.${
          stale ? ' Reopen the latest review before deciding.' : ''
        }`,
      });
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const disabled =
    busy ||
    conflict ||
    resource.loading ||
    !!resource.error ||
    !data?.canReview;
  const unit = data?.syllabus.units.find(
    u => u.unitId === data.submittedContent.unitId,
  );
  return (
    <DashboardShell keyboardShouldPersistTaps="handled">
      <Button
        title="Back to approvals"
        variant="secondary"
        disabled={busy}
        onPress={() => navigation.goBack()}
      />
      <ScreenHeading
        title="Lesson Plan Review"
        subtitle={
          data
            ? `${data.teacherName} • ${data.className} • Section ${data.sectionName}`
            : 'Branch academic review'
        }
      />
      <LoadState
        loading={resource.loading}
        error={resource.error}
        retry={resource.refresh}
        label="Loading submitted lesson..."
      />
      {feedback ? <AdminFeedback {...feedback} /> : null}
      {data ? (
        <>
          <SectionCard title={`Submitted revision ${data.submittedRevision}`}>
            <StatusBadge
              status={data.lesson.state === 'approved' ? 'paid' : 'pending'}
              label={data.lesson.state.replaceAll('_', ' ')}
            />
            <Text style={formStyles.label}>
              {data.syllabus.title} • Version {data.syllabus.version} •{' '}
              {data.lesson.academicYear}
            </Text>
            <Text style={formStyles.copy}>
              {unit?.title} • {data.submittedContent.teachingDate}
            </Text>
            {unit?.topics
              .filter(t => data.submittedContent.topicIds.includes(t.topicId))
              .map(t => (
                <Text key={t.topicId} style={formStyles.copy}>
                  {t.title}
                </Text>
              ))}
            <Text style={formStyles.label}>Objectives</Text>
            <Text style={formStyles.copy}>
              {data.submittedContent.objectives}
            </Text>
            <Text style={formStyles.label}>Teaching activities</Text>
            <Text style={formStyles.copy}>
              {data.submittedContent.teachingActivities}
            </Text>
            <Text style={formStyles.label}>Resources / notes</Text>
            <Text style={formStyles.copy}>
              {data.submittedContent.resources}
              {'\n'}
              {data.submittedContent.notes}
            </Text>
            <Text style={formStyles.label}>Review note</Text>
            <TextInput
              accessibilityLabel="Lesson review note"
              style={formStyles.input}
              multiline
              maxLength={500}
              value={note}
              editable={!disabled}
              onChangeText={setNote}
            />
            {(['approved', 'needs_revision', 'rejected'] as const).map(
              value => (
                <Button
                  key={value}
                  title={
                    value === 'approved'
                      ? 'Approve Lesson'
                      : value === 'needs_revision'
                      ? 'Request Revision'
                      : 'Reject Lesson'
                  }
                  variant={value === 'approved' ? 'primary' : 'secondary'}
                  disabled={disabled}
                  onPress={() => {
                    if (value !== 'approved' && !note.trim()) {
                      setFeedback({
                        kind: 'error',
                        title: 'Review note required',
                        message: 'Explain the requested revision or rejection.',
                      });
                      return;
                    }
                    setAction(value);
                  }}
                />
              ),
            )}
          </SectionCard>
          <SectionCard title="Submission and Review History">
            {data.lesson.submissions?.map(s => (
              <Text key={s.revision} style={formStyles.copy}>
                Submitted revision {s.revision} • {s.submittedAt}
                {'\n'}
                {s.content.objectives}
                {'\n'}
                {s.content.teachingActivities}
              </Text>
            ))}
            {data.lesson.reviews?.map((r, i) => (
              <Text key={i} style={formStyles.copy}>
                Revision {r.submittedRevision}: {r.action.replaceAll('_', ' ')}{' '}
                • {r.reviewedAt}
                {'\n'}
                {r.note}
              </Text>
            ))}
          </SectionCard>
          <SectionCard title="Actual Delivery Evidence">
            {data.delivery ? (
              data.delivery.history.map(h => (
                <Text key={h.revision} style={formStyles.copy}>
                  Evidence revision {h.revision} • {h.actualTeachingDate} •{' '}
                  {h.deliveryStatus.replaceAll('_', ' ')}
                  {' • '}
                  {h.recordedByName ?? 'Teacher'}
                  {' • '}
                  {h.recordedAt}
                  {'\n'}
                  {h.topics
                    .map(
                      t =>
                        `${
                          data.syllabus.units
                            .flatMap(u => u.topics)
                            .find(topic => topic.topicId === t.topicId)
                            ?.title ?? 'Topic'
                        }: ${t.state.replaceAll('_', ' ')} — ${t.evidence}`,
                    )
                    .join('\n')}
                  {'\n'}
                  {h.correctionReason}
                </Text>
              ))
            ) : (
              <Text style={formStyles.copy}>
                No delivery evidence recorded. Approval does not imply delivery.
              </Text>
            )}
          </SectionCard>
          <SyllabusCoverage coverage={data.coverage} />
        </>
      ) : null}
      <AdminDialog
        visible={!!action}
        title="Confirm lesson review"
        busy={busy}
        busyLabel="Recording decision"
        onClose={() => setAction(null)}
        onConfirm={decide}
        confirmTitle="Confirm Decision"
      >
        <Text style={formStyles.copy}>
          {data?.teacherName} • {data?.className} • Section {data?.sectionName}
          {'\n'}Revision {data?.submittedRevision} •{' '}
          {action?.replaceAll('_', ' ')}
          {'\n'}
          {note}
        </Text>
      </AdminDialog>
    </DashboardShell>
  );
}
