import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Text, TextInput } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { TeacherStackParamList } from '../../navigation/TeacherNavigator';
import { useAuth } from '../../context/AuthContext';
import {
  Button,
  DashboardShell,
  ScreenHeading,
  SectionCard,
} from '../../components/hiraDashboard';
import {
  AdminDateField,
  AdminDialog,
  AdminFeedback,
  formStyles,
} from '../../components/hiraDashboard/AdminForm';
import SyllabusCoverage from '../../components/academic/SyllabusCoverage';
import {
  academicOperationId,
  academicService,
  type DeliveryContext,
  type TopicEvidence,
} from '../../services/teacher/academicService';
import { useTeacherResource } from './useTeacherResource';
import { LoadState } from './teacherUi';
import { ApiError } from '../../services/api/apiClient';

export default function TeacherDeliveryScreen(
  props: NativeStackScreenProps<TeacherStackParamList, 'TeacherDelivery'>,
) {
  return <DeliveryForm key={props.route.params.lessonPlanId} {...props} />;
}
function DeliveryForm({
  route,
}: NativeStackScreenProps<TeacherStackParamList, 'TeacherDelivery'>) {
  const { accessToken } = useAuth();
  const load = useCallback(() => {
    if (!accessToken)
      return Promise.reject(new Error('Authentication required'));
    return academicService.deliveryContext(
      accessToken,
      route.params.lessonPlanId,
    );
  }, [accessToken, route.params.lessonPlanId]);
  const resource = useTeacherResource(load);
  const [confirmed, setConfirmed] = useState<DeliveryContext | null>(null);
  useEffect(() => {
    setConfirmed(null);
  }, [resource.data]);
  const context =
    resource.loading || resource.error ? null : confirmed ?? resource.data;
  const latest = context?.delivery?.history.at(-1);
  const [topics, setTopics] = useState<TopicEvidence[] | null>(null);
  const selected =
    topics ??
    latest?.topics ??
    context?.lesson.topicIds.map(topicId => ({
      topicId,
      state: 'not_covered' as const,
      evidence: '',
    })) ??
    [];
  const [date, setDate] = useState<string | null>(null),
    [notes, setNotes] = useState<string | null>(null),
    [reason, setReason] = useState('');
  const actualDate =
    date ?? latest?.actualTeachingDate ?? context?.lesson.teachingDate ?? '';
  const teacherNotes = notes ?? latest?.teacherNotes ?? '';
  const [confirm, setConfirm] = useState(false),
    [busy, setBusy] = useState(false),
    [conflict, setConflict] = useState(false);
  const [feedback, setFeedback] = useState<{
    kind: 'success' | 'error';
    title: string;
    message: string;
  } | null>(null);
  const lock = useRef(false),
    pending = useRef<{ key: string; id: string } | null>(null);
  const disabled =
    busy ||
    conflict ||
    resource.loading ||
    !!resource.error ||
    !context?.canRecord;
  const status: 'delivered' | 'partially_delivered' | 'not_delivered' =
    selected.every(t => t.state === 'completed')
      ? 'delivered'
      : selected.every(t => t.state === 'not_covered')
      ? 'not_delivered'
      : 'partially_delivered';
  const unit = context?.syllabus.units.find(
    u => u.unitId === context.lesson.unitId,
  );
  const label = (id: string) =>
    unit?.topics.find(t => t.topicId === id)?.title ?? 'Planned topic';
  const validate = () => {
    const parsed = new Date(`${actualDate}T00:00:00Z`);
    if (
      !context ||
      !/^\d{4}-\d{2}-\d{2}$/.test(actualDate) ||
      !Number.isFinite(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== actualDate ||
      actualDate > context.today ||
      actualDate < context.lesson.teachingDate ||
      !selected.length ||
      selected.some(t => !t.evidence.trim()) ||
      (!!context.delivery && !reason.trim())
    ) {
      setFeedback({
        kind: 'error',
        title: 'Complete delivery evidence',
        message:
          'Enter a valid actual date, evidence for every planned topic, and a correction reason when revising. Future delivery is unavailable.',
      });
      return false;
    }
    return true;
  };
  const save = async () => {
    if (lock.current || disabled || !accessToken || !context || !validate())
      return;
    lock.current = true;
    setBusy(true);
    setFeedback(null);
    const payload = {
      lessonPlanRevision: context.lesson.approvedRevision!,
      revision: context.delivery?.revision ?? 0,
      deliveryStatus: status,
      actualTeachingDate: actualDate,
      topics: selected,
      teacherNotes,
      correctionReason: reason,
    };
    const key = JSON.stringify(payload);
    if (pending.current?.key !== key)
      pending.current = { key, id: academicOperationId() };
    try {
      const result = await academicService.recordDelivery(
        accessToken,
        context.lesson.lessonPlanId,
        { ...payload, clientOperationId: pending.current.id },
      );
      setConfirmed(result);
      setTopics(null);
      setDate(null);
      setNotes(null);
      setReason('');
      setConfirm(false);
      pending.current = null;
      setFeedback({
        kind: 'success',
        title: 'Lesson delivery recorded successfully.',
        message:
          'Coverage now reflects the confirmed topic evidence. Previous evidence remains in history.',
      });
    } catch (e) {
      const stale = e instanceof ApiError && e.status === 409;
      if (stale) {
        setConflict(true);
        setConfirm(false);
      }
      setFeedback({
        kind: 'error',
        title: stale
          ? 'Delivery revision conflict'
          : 'Unable to record delivery',
        message: `${
          e instanceof Error ? e.message : 'Please retry.'
        } Your input has been retained.${
          stale
            ? ' Reopen this lesson to load current evidence before correcting it.'
            : ''
        }`,
      });
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  return (
    <DashboardShell safeArea={false} keyboardShouldPersistTaps="handled">
      <ScreenHeading
        title="Record Lesson Delivery"
        subtitle={
          context
            ? `${context.className} • Section ${context.sectionName} • ${context.teacherName}`
            : 'Actual teaching evidence'
        }
      />
      <LoadState
        loading={resource.loading}
        error={resource.error}
        retry={resource.refresh}
        label="Loading approved lesson..."
      />
      {feedback ? <AdminFeedback {...feedback} /> : null}
      {context ? (
        <>
          <SectionCard title="Approved Lesson Plan">
            <Text style={formStyles.label}>
              {context.syllabus.title} • Version {context.syllabus.version} •{' '}
              {context.lesson.academicYear}
            </Text>
            <Text style={formStyles.copy}>
              {unit?.title} • Planned {context.lesson.teachingDate}
              {context.period
                ? ` • ${context.period.startTime}–${context.period.endTime}${
                    context.period.isSubstitute ? ' • Substitute' : ''
                  }`
                : ' • Date-based lesson'}
            </Text>
            <Text style={formStyles.copy}>{context.lesson.objectives}</Text>
            {selected.map(t => (
              <Text key={t.topicId} style={formStyles.copy}>
                {label(t.topicId)}
              </Text>
            ))}
            {!context.canRecord ? (
              <Text style={formStyles.copy}>
                Delivery requires an approved current lesson revision.
              </Text>
            ) : null}
          </SectionCard>
          <SectionCard title="Actual Delivery">
            <Text style={formStyles.label}>
              Overall: {status.replaceAll('_', ' ')}
            </Text>
            <AdminDateField
              label="Actual teaching date"
              value={actualDate}
              onChange={setDate}
              disabled={disabled}
              helper="School-local date. Date-based catch-up may be later than planned; occurrence evidence uses the occurrence date."
            />
            {selected.map(topic => (
              <SectionCard key={topic.topicId} title={label(topic.topicId)}>
                {(['completed', 'partial', 'not_covered'] as const).map(
                  state => (
                    <Button
                      key={state}
                      title={`${state === topic.state ? 'Selected: ' : ''}${
                        state === 'not_covered'
                          ? 'Not covered'
                          : state === 'partial'
                          ? 'Partial'
                          : 'Completed'
                      } — ${label(topic.topicId)}`}
                      variant={state === topic.state ? 'primary' : 'secondary'}
                      disabled={disabled}
                      onPress={() =>
                        setTopics(
                          selected.map(t =>
                            t.topicId === topic.topicId ? { ...t, state } : t,
                          ),
                        )
                      }
                    />
                  ),
                )}
                <Text style={formStyles.label}>Evidence / explanation</Text>
                <TextInput
                  accessibilityLabel={`Evidence for ${label(topic.topicId)}`}
                  style={formStyles.input}
                  multiline
                  maxLength={1000}
                  editable={!disabled}
                  value={topic.evidence}
                  onChangeText={evidence =>
                    setTopics(
                      selected.map(t =>
                        t.topicId === topic.topicId ? { ...t, evidence } : t,
                      ),
                    )
                  }
                />
              </SectionCard>
            ))}
            <Text style={formStyles.label}>Teacher notes</Text>
            <TextInput
              accessibilityLabel="Delivery notes"
              style={formStyles.input}
              multiline
              maxLength={4000}
              value={teacherNotes}
              editable={!disabled}
              onChangeText={setNotes}
            />
            {context.delivery ? (
              <>
                <Text style={formStyles.label}>Correction reason</Text>
                <TextInput
                  accessibilityLabel="Correction reason"
                  style={formStyles.input}
                  value={reason}
                  editable={!disabled}
                  onChangeText={setReason}
                  maxLength={500}
                />
              </>
            ) : null}
            <Button
              title={
                busy
                  ? 'Recording delivery...'
                  : context.delivery
                  ? 'Correct Delivery Evidence'
                  : 'Confirm Delivery'
              }
              disabled={disabled}
              onPress={() => {
                if (validate()) setConfirm(true);
              }}
            />
          </SectionCard>
          {context.delivery ? (
            <SectionCard title="Delivery History">
              {context.delivery.history.map(h => (
                <Text key={h.revision} style={formStyles.copy}>
                  Revision {h.revision} • {h.actualTeachingDate} •{' '}
                  {h.deliveryStatus.replaceAll('_', ' ')} • {h.recordedAt}
                  {' • '}
                  {h.recordedByName ?? 'Teacher'}
                  {'\n'}
                  {h.correctionReason}
                  {'\n'}
                  {h.topics
                    .map(
                      t =>
                        `${label(t.topicId)}: ${t.state.replaceAll(
                          '_',
                          ' ',
                        )} — ${t.evidence}`,
                    )
                    .join('\n')}
                </Text>
              ))}
            </SectionCard>
          ) : null}
          <SyllabusCoverage coverage={context.coverage} />
        </>
      ) : null}
      <AdminDialog
        visible={confirm}
        title="Record Lesson Delivery"
        busy={busy}
        busyLabel="Recording evidence"
        onClose={() => setConfirm(false)}
        onConfirm={save}
        confirmTitle="Confirm Delivery"
      >
        <Text style={formStyles.copy}>
          {context?.className} • Section {context?.sectionName}
          {'\n'}
          {context?.syllabus.title} • {unit?.title}
          {'\n'}
          {actualDate}
          {'\n'}
          {selected
            .map(
              t =>
                `${label(t.topicId)}: ${t.state.replaceAll('_', ' ')} — ${
                  t.evidence
                }`,
            )
            .join('\n')}
        </Text>
        <Text style={formStyles.helper}>
          Only this explicit evidence updates coverage. Corrections preserve the
          original record.
        </Text>
      </AdminDialog>
    </DashboardShell>
  );
}
