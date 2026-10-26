import React, { useCallback, useRef, useState } from 'react';
import { Text, TextInput } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { TeacherStackParamList } from '../../navigation/TeacherNavigator';
import { useAuth } from '../../context/AuthContext';
import { Button, DashboardShell, ScreenHeading, SectionCard, StatusBadge } from '../../components/hiraDashboard';
import { AdminDateField, AdminDialog, AdminFeedback, formStyles } from '../../components/hiraDashboard/AdminForm';
import { useTeacherResource } from './useTeacherResource';
import { LoadState } from './teacherUi';
import { academicWorkOperationId, academicWorkService, type HomeworkRecord, type AudiencePreview } from '../../services/teacher/academicWorkService';
import { ApiError } from '../../services/api/apiClient';

export default function TeacherHomeworkScreen({ route }: NativeStackScreenProps<TeacherStackParamList, 'TeacherHomework'>) {
  const { accessToken } = useAuth();
  const load = useCallback(() => accessToken
    ? academicWorkService.context(accessToken, route.params.lessonPlanId)
    : Promise.reject(new Error('Authentication required')), [accessToken, route.params.lessonPlanId]);
  const resource = useTeacherResource(load);
  const [saved, setSaved] = useState<HomeworkRecord | null>(null);
  const [confirmationDraft, setConfirmationDraft] = useState<HomeworkRecord | null>(null);
  const [title, setTitle] = useState(''), [instructions, setInstructions] = useState(''), [dueAt, setDueAt] = useState('');
  const [topics, setTopics] = useState<string[]>([]), [audience, setAudience] = useState<AudiencePreview | null>(null);
  const [confirm, setConfirm] = useState(false), [busy, setBusy] = useState(false), [conflict, setConflict] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; title: string; message: string } | null>(null);
  const lock = useRef(false), operation = useRef<string | null>(null);
  const context = resource.data, lesson = context?.lesson;
  const unit = lesson?.syllabus.units.find(value => value.unitId === lesson.unitId);
  const availableTopics = unit?.topics.filter(topic => lesson?.topicIds.includes(topic.topicId)) ?? [];
  const disabled = busy || conflict || resource.loading || !!resource.error || saved?.status === 'published';
  const valid = () => {
    if (!title.trim() || !instructions.trim() || !topics.length || !/^\d{4}-\d{2}-\d{2}$/.test(dueAt)) {
      setFeedback({ kind: 'error', title: 'Complete the homework draft', message: 'Title, instructions, syllabus topics and a valid due date are required.' });
      return false;
    }
    return true;
  };
  const save = async () => {
    if (!accessToken || !lesson || lock.current || !valid()) return null;
    lock.current = true; setBusy(true); setFeedback(null);
    try {
      const body = { lessonPlanId: lesson.lessonPlanId, topicIds: topics, title, instructions, dueAt,
        ...(saved ? { revision: saved.revision } : {}), clientOperationId: academicWorkOperationId('homework') };
      const result = await academicWorkService.saveHomework(accessToken, body, saved?.homeworkId);
      setSaved(result);
      setFeedback({ kind: 'success', title: 'Homework draft saved', message: `Server confirmed revision ${result.revision}. Publication has not occurred.` });
      return result;
    } catch (error) {
      const stale = error instanceof ApiError && error.status === 409;
      if (stale) setConflict(true);
      setFeedback({ kind: 'error', title: stale ? 'Homework revision conflict' : 'Unable to save homework', message: `${error instanceof Error ? error.message : 'Please retry.'} Your form has been retained.` });
      return null;
    } finally { lock.current = false; setBusy(false); }
  };
  const prepare = async () => {
    const current = await save();
    if (!current || !accessToken) return;
    try { const preview = await academicWorkService.previewHomework(accessToken, current.homeworkId); setAudience(preview); setConfirmationDraft(current); setConfirm(true); }
    catch (error) { setFeedback({ kind: 'error', title: 'Unable to preview recipients', message: error instanceof Error ? error.message : 'Please retry.' }); }
  };
  const publish = async () => {
    if (!confirmationDraft || !accessToken || lock.current) return;
    lock.current = true; setBusy(true); setFeedback(null);
    operation.current ??= academicWorkOperationId('publish_homework');
    try {
      const result = await academicWorkService.publishHomework(accessToken, confirmationDraft.homeworkId, confirmationDraft.revision, operation.current);
      setSaved(result); setConfirmationDraft(null); setConfirm(false); operation.current = null;
      setFeedback({ kind: 'success', title: 'Homework published successfully.', message: `${result.recipientCount} learners assigned • Due ${result.dueAt}.` });
    } catch (error) { setFeedback({ kind: 'error', title: 'Unable to publish homework', message: `${error instanceof Error ? error.message : 'Please retry.'} Your draft has been retained.` }); }
    finally { lock.current = false; setBusy(false); }
  };
  return <DashboardShell safeArea={false} keyboardShouldPersistTaps="handled">
    <ScreenHeading title="Create Homework" subtitle={lesson ? `${lesson.className} • Section ${lesson.sectionName} • ${lesson.syllabus.title}` : 'Lesson-linked academic work'} />
    <LoadState loading={resource.loading} error={resource.error} retry={resource.refresh} label="Loading lesson context..." />
    {feedback ? <AdminFeedback {...feedback} /> : null}
    {saved ? <StatusBadge status={saved.status === 'published' ? 'paid' : 'pending'} label={`${saved.status} • Revision ${saved.revision}`} /> : null}
    {lesson ? <>
      <SectionCard title="1. Academic Context"><Text style={formStyles.copy}>{lesson.teacherName} • Academic Year {lesson.academicYear}{'\n'}Lesson revision {lesson.lessonPlanRevision} • {lesson.lessonState}{lesson.occurrence?.isSubstitute ? ' • Exact substitute occurrence' : ''}</Text></SectionCard>
      <SectionCard title="2. Homework Details">
        <Text style={formStyles.label}>Title</Text><TextInput accessibilityLabel="Homework title" style={formStyles.input} value={title} onChangeText={setTitle} editable={!disabled} maxLength={200} />
        <Text style={formStyles.label}>Instructions</Text><TextInput accessibilityLabel="Homework instructions" style={formStyles.input} value={instructions} onChangeText={setInstructions} editable={!disabled} multiline maxLength={8000} />
      </SectionCard>
      <SectionCard title="3. Syllabus Topics">{availableTopics.map(topic => <Button key={topic.topicId} title={`${topics.includes(topic.topicId) ? 'Selected: ' : ''}${topic.title}`} variant="secondary" disabled={disabled} onPress={() => setTopics(current => current.includes(topic.topicId) ? current.filter(id => id !== topic.topicId) : [...current, topic.topicId])} />)}</SectionCard>
      <SectionCard title="4. Audience"><Text style={formStyles.copy}>{lesson.className} • Section {lesson.sectionName}{'\n'}{audience?.recipientCount ?? context.audience.recipientCount} eligible students</Text><Text style={formStyles.helper}>Preview is informational. The server re-resolves and snapshots the roster during publication.</Text></SectionCard>
      <SectionCard title="5. Schedule / Due Date"><AdminDateField label="Homework due date" value={dueAt} onChange={setDueAt} disabled={disabled} helper="School-local date. Work closes after this date; no penalty is calculated." /></SectionCard>
      {saved?.status !== 'published' ? <><Button title={busy ? 'Saving...' : 'Save Homework Draft'} disabled={disabled} onPress={save} /><Button title="Review & Publish Homework" disabled={disabled} onPress={prepare} /></> : null}
    </> : null}
    <AdminDialog visible={confirm} title="Publish Homework" busy={busy} busyLabel="Publishing homework" onClose={() => setConfirm(false)} onConfirm={publish} confirmTitle="Publish">
      <Text style={formStyles.copy}>{confirmationDraft?.title}{'\n'}{confirmationDraft?.instructions}{'\n'}{lesson?.className} • Section {lesson?.sectionName}{'\n'}{availableTopics.filter(topic => confirmationDraft?.topicIds.includes(topic.topicId)).map(topic => topic.title).join(', ')}{'\n'}Due {confirmationDraft?.dueAt}{'\n'}{audience?.recipientCount ?? 0} recipients</Text>
    </AdminDialog>
  </DashboardShell>;
}
