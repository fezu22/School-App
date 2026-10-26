import React, { useCallback, useRef, useState } from 'react';
import { Text, TextInput } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { TeacherStackParamList } from '../../navigation/TeacherNavigator';
import { useAuth } from '../../context/AuthContext';
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
  academicOperationId,
  academicService,
  type LessonDetails,
} from '../../services/teacher/academicService';
import { ApiError } from '../../services/api/apiClient';
import { useTeacherResource } from './useTeacherResource';
import { LoadState } from './teacherUi';

type LessonScreenProps = NativeStackScreenProps<
  TeacherStackParamList,
  'TeacherLesson'
>;
export default function TeacherLessonScreen(props: LessonScreenProps) {
  const { classId, sectionId, subjectId } = props.route.params;
  return (
    <LessonEditor key={`${classId}:${sectionId}:${subjectId}`} {...props} />
  );
}
function LessonEditor({ route }: LessonScreenProps) {
  const { accessToken } = useAuth();
  const { classId, sectionId, subjectId } = route.params;
  const [saved, setSaved] = useState(route.params.lesson);
  const [form, setForm] = useState<LessonDetails>(() =>
    route.params.lesson
      ? {
          unitId: route.params.lesson.unitId,
          topicIds: [...route.params.lesson.topicIds],
          teachingDate: route.params.lesson.teachingDate,
          objectives: route.params.lesson.objectives,
          teachingActivities: route.params.lesson.teachingActivities,
          resources: route.params.lesson.resources,
          notes: route.params.lesson.notes,
        }
      : {
          unitId: '',
          topicIds: [],
          teachingDate: route.params.occurrence?.date ?? '',
          objectives: '',
          teachingActivities: '',
          resources: '',
          notes: '',
        },
  );
  const [busy, setBusy] = useState(false),
    [confirm, setConfirm] = useState(false);
  const [feedback, setFeedback] = useState<{
    kind: 'success' | 'error';
    title: string;
    message: string;
  } | null>(null);
  const [conflict, setConflict] = useState(false);
  const lock = useRef(false),
    pending = useRef<{ key: string; id: string } | null>(null);
  const load = useCallback(async () => {
    if (!accessToken) throw new Error('Authentication required');
    return academicService.context(accessToken, {
      classId,
      sectionId,
      subjectId,
    });
  }, [accessToken, classId, sectionId, subjectId]);
  const resource = useTeacherResource(load),
    context = resource.data,
    syllabus = context?.syllabus;
  const unit = syllabus?.units.find(u => u.unitId === form.unitId);
  const readonly = !!saved && saved.state !== 'draft';
  const disabled =
    busy ||
    readonly ||
    conflict ||
    resource.loading ||
    !!resource.error ||
    !syllabus ||
    (!!saved && saved.syllabusId !== syllabus.syllabusId);
  const change = <K extends keyof LessonDetails>(
    key: K,
    value: LessonDetails[K],
  ) => {
    setForm(previous => ({ ...previous, [key]: value }));
    setFeedback(null);
  };
  const valid = () => {
    const parsed = new Date(`${form.teachingDate}T00:00:00.000Z`);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(form.teachingDate) ||
      !Number.isFinite(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== form.teachingDate ||
      !unit ||
      !form.topicIds.length ||
      form.topicIds.some(id => !unit.topics.some(t => t.topicId === id)) ||
      !form.objectives.trim() ||
      !form.teachingActivities.trim()
    ) {
      setFeedback({
        kind: 'error',
        title: 'Complete lesson details',
        message:
          'Select a unit and topics, enter a valid date, objectives and teaching activities.',
      });
      return false;
    }
    return true;
  };
  const operation = (key: string) => {
    if (pending.current?.key !== key)
      pending.current = { key, id: academicOperationId() };
    return pending.current.id;
  };
  const save = async (submit = false) => {
    if (lock.current || disabled || !accessToken || !syllabus || !valid())
      return;
    lock.current = true;
    setBusy(true);
    setFeedback(null);
    try {
      let lesson = saved;
      if (
        !submit ||
        !lesson ||
        JSON.stringify(form) !==
          JSON.stringify({
            unitId: lesson.unitId,
            topicIds: lesson.topicIds,
            teachingDate: lesson.teachingDate,
            objectives: lesson.objectives,
            teachingActivities: lesson.teachingActivities,
            resources: lesson.resources,
            notes: lesson.notes,
          })
      ) {
        const key = JSON.stringify({
          action: 'save',
          id: lesson?.lessonPlanId,
          revision: lesson?.revision,
          form,
        });
        const clientOperationId = operation(key);
        lesson = lesson
          ? await academicService.update(accessToken, lesson.lessonPlanId, {
              ...form,
              revision: lesson.revision,
              clientOperationId,
            })
          : await academicService.create(accessToken, {
              ...form,
              classId,
              sectionId,
              subjectId,
              syllabusId: syllabus.syllabusId,
              occurrence: route.params.occurrence,
              clientOperationId,
            });
        setSaved(lesson);
        setForm({
          unitId: lesson.unitId,
          topicIds: [...lesson.topicIds],
          teachingDate: lesson.teachingDate,
          objectives: lesson.objectives,
          teachingActivities: lesson.teachingActivities,
          resources: lesson.resources,
          notes: lesson.notes,
        });
        pending.current = null;
      }
      if (submit) {
        const clientOperationId = operation(
          `submit:${lesson.lessonPlanId}:${lesson.revision}`,
        );
        lesson = await academicService.submit(
          accessToken,
          lesson.lessonPlanId,
          lesson.revision,
          clientOperationId,
        );
        setSaved(lesson);
        pending.current = null;
        setConfirm(false);
      }
      setFeedback({
        kind: 'success',
        title: submit ? 'Lesson submitted' : 'Draft saved',
        message: submit
          ? 'Your submitted content is frozen and awaits an authorized Principal review. Submission does not mean approval or delivery.'
          : `Server confirmed revision ${lesson.revision}. You can continue editing this draft.`,
      });
    } catch (e) {
      const stale = e instanceof ApiError && e.status === 409;
      if (stale) {
        setConflict(true);
        setConfirm(false);
      }
      setFeedback({
        kind: 'error',
        title: stale ? 'Revision conflict' : 'Unable to save lesson',
        message: stale
          ? 'Your form has been retained. Reopen the latest lesson from Classes before applying these changes.'
          : e instanceof Error
          ? e.message
          : 'Your form has been retained. Please retry.',
      });
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  return (
    <DashboardShell safeArea={false} keyboardShouldPersistTaps="handled">
      <ScreenHeading
        title="Lesson Plan"
        subtitle={
          context
            ? `${context.assignment.className} • Section ${context.assignment.sectionName} • ${context.assignment.subjectName}`
            : 'Assigned academic planning'
        }
      />
      <LoadState
        loading={resource.loading}
        error={resource.error}
        retry={resource.refresh}
        label="Loading published syllabus..."
      />
      {feedback ? <AdminFeedback {...feedback} /> : null}
      {saved ? (
        <StatusBadge
          status="pending"
          label={`${
            saved.state.replaceAll('_', ' ')
          } • Revision ${saved.revision}`}
        />
      ) : null}
      {readonly ? (
        <Text style={formStyles.copy}>
          Submitted content is read-only. Review decisions do not record actual delivery.
        </Text>
      ) : null}
      {context && !syllabus ? (
        <Text style={formStyles.copy}>
          No current published syllabus. Planning is unavailable.
        </Text>
      ) : null}
      {saved && syllabus && saved.syllabusId !== syllabus.syllabusId ? (
        <Text style={formStyles.copy}>
          This lesson references a replaced syllabus. Create a new draft against
          the current publication.
        </Text>
      ) : null}
      <SectionCard title="1. Teaching Context">
        <Text style={formStyles.copy}>
          {context?.teacherName} • Academic Year {context?.academicYear}
        </Text>
        <AdminDateField
          label="Teaching date"
          value={form.teachingDate}
          onChange={v => change('teachingDate', v)}
          disabled={disabled}
          helper="YYYY-MM-DD • Planning date within your assignment validity"
        />
        <Text style={formStyles.helper}>
          {saved?.occurrence || route.params.occurrence ? 'Linked to the selected timetable occurrence. Its teaching date must match.' : 'Date-based planning. No timetable period is linked.'}
        </Text>
      </SectionCard>
      {saved?.reviews?.length ? <SectionCard title="Review History">{saved.reviews.map((review, i) => <Text key={i} style={formStyles.copy}>Revision {review.submittedRevision}: {review.action.replaceAll('_', ' ')} • {review.reviewedAt}{'\n'}{review.note}</Text>)}</SectionCard> : null}
      {saved?.submissions?.length ? <SectionCard title="Submitted Revisions">{saved.submissions.map(s => <Text key={s.revision} style={formStyles.copy}>Revision {s.revision} • {s.submittedAt}{'\n'}{s.content.objectives}{'\n'}{s.content.teachingActivities}</Text>)}</SectionCard> : null}
      {saved?.state === 'needs_revision' || (saved?.state === 'submitted' && !saved.approvalRequestId) ? <Button title={saved.state === 'needs_revision' ? 'Start Revised Draft' : 'Request Principal Review'} disabled={busy || conflict || resource.loading || !!resource.error} onPress={async () => {
        if (lock.current || !accessToken) return;
        lock.current = true; setBusy(true); setFeedback(null);
        const action = saved.state === 'needs_revision' ? 'revise' : 'submit';
        try {
          const result = await academicService[action](accessToken, saved.lessonPlanId, saved.revision, operation(`${action}:${saved.lessonPlanId}:${saved.revision}`));
          setSaved(result); pending.current = null;
        } catch (e) {
          if (e instanceof ApiError && e.status === 409) setConflict(true);
          setFeedback({kind: 'error', title: 'Unable to update lesson', message: e instanceof Error ? e.message : 'Please retry. Your input is retained.'});
        } finally { lock.current = false; setBusy(false); }
      }} /> : null}
      <SectionCard title="2. Syllabus Mapping">
        <Text style={formStyles.label}>
          {syllabus
            ? `${syllabus.title} • Published version ${syllabus.version}`
            : 'Published syllabus required'}
        </Text>
        <AdminSelect
          label="Unit"
          value={form.unitId}
          options={
            syllabus?.units.map(u => ({
              id: u.unitId,
              label: `${u.order}. ${u.title}`,
            })) ?? []
          }
          placeholder="Select a unit"
          helper="Choose from the published syllabus"
          disabled={disabled}
          onSelect={id => {
            setForm(previous => ({ ...previous, unitId: id, topicIds: [] }));
            setFeedback(null);
          }}
        />
        {unit?.topics.map(topic => (
          <React.Fragment key={topic.topicId}>
            <Button
              title={`${
                form.topicIds.includes(topic.topicId) ? 'Selected: ' : ''
              }${topic.title}`}
              variant="secondary"
              disabled={disabled}
              onPress={() =>
                change(
                  'topicIds',
                  form.topicIds.includes(topic.topicId)
                    ? form.topicIds.filter(id => id !== topic.topicId)
                    : [...form.topicIds, topic.topicId],
                )
              }
            />
            {topic.outcomes.map((outcome, index) => (
              <Text key={index} style={formStyles.helper}>
                {outcome}
              </Text>
            ))}
          </React.Fragment>
        ))}
        {!unit ? (
          <Text style={formStyles.helper}>
            Select a unit to choose topics and learning objectives.
          </Text>
        ) : null}
      </SectionCard>
      <SectionCard title="3. Lesson Details">
        {(
          ['objectives', 'teachingActivities', 'resources', 'notes'] as const
        ).map(key => (
          <React.Fragment key={key}>
            <Text style={formStyles.label}>
              {
                {
                  objectives: 'Objectives',
                  teachingActivities: 'Teaching activities',
                  resources: 'Resources',
                  notes: 'Notes',
                }[key]
              }
            </Text>
            <TextInput
              accessibilityLabel={key}
              style={formStyles.input}
              multiline
              editable={!disabled}
              value={form[key]}
              onChangeText={v => change(key, v)}
              maxLength={key === 'teachingActivities' ? 8000 : 4000}
            />
          </React.Fragment>
        ))}
      </SectionCard>
      {!readonly ? (
        <>
          <Button
            title={busy ? 'Saving...' : 'Save Draft'}
            disabled={disabled}
            onPress={() => save()}
          />
          <Button
            title="Submit Lesson"
            disabled={disabled}
            onPress={() => {
              if (valid()) setConfirm(true);
            }}
          />
        </>
      ) : null}
      <AdminDialog
        visible={confirm}
        title="Submit lesson?"
        busy={busy}
        busyLabel="Submitting lesson"
        onClose={() => setConfirm(false)}
        onConfirm={() => save(true)}
        confirmTitle="Confirm submission"
      >
        <Text style={formStyles.copy}>
          {context?.teacherName}
          {'\n'}
          {context?.assignment.className} • Section{' '}
          {context?.assignment.sectionName} • {context?.assignment.subjectName}
          {'\n'}
          {form.teachingDate}
          {'\n'}
          {syllabus?.title} • {unit?.title}
          {'\n'}
          {unit?.topics
            .filter(t => form.topicIds.includes(t.topicId))
            .map(t => t.title)
            .join(', ')}
          {'\n'}
          {form.objectives}
        </Text>
        <Text style={formStyles.helper}>
          Submission freezes this revision for authorized Principal review.
          Approval does not mean delivery.
        </Text>
      </AdminDialog>
    </DashboardShell>
  );
}
