import React, { useCallback, useRef, useState } from 'react';
import { Text, TextInput } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { TeacherStackParamList } from '../../navigation/TeacherNavigator';
import { useAuth } from '../../context/AuthContext';
import { Button, DashboardShell, ScreenHeading, SectionCard, StatusBadge } from '../../components/hiraDashboard';
import { AdminDateField, AdminDialog, AdminFeedback, formStyles } from '../../components/hiraDashboard/AdminForm';
import { useTeacherResource } from './useTeacherResource';
import { LoadState } from './teacherUi';
import { academicWorkOperationId, academicWorkService, type AudiencePreview, type QuizQuestion, type QuizRecord } from '../../services/teacher/academicWorkService';
import { ApiError } from '../../services/api/apiClient';

const localId = (prefix: string) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
export default function TeacherQuizScreen({ route }: NativeStackScreenProps<TeacherStackParamList, 'TeacherQuiz'>) {
  const { accessToken } = useAuth();
  const load = useCallback(() => accessToken
    ? academicWorkService.context(accessToken, route.params.lessonPlanId)
    : Promise.reject(new Error('Authentication required')), [accessToken, route.params.lessonPlanId]);
  const resource = useTeacherResource(load);
  const [saved, setSaved] = useState<QuizRecord | null>(null), [title, setTitle] = useState(''), [instructions, setInstructions] = useState('');
  const [confirmationDraft, setConfirmationDraft] = useState<QuizRecord | null>(null);
  const [topics, setTopics] = useState<string[]>([]), [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [availableFrom, setAvailableFrom] = useState(''), [availableUntil, setAvailableUntil] = useState('');
  const [attemptLimit, setAttemptLimit] = useState('1'), [timeLimit, setTimeLimit] = useState(''), [shuffle, setShuffle] = useState(false);
  const [audience, setAudience] = useState<AudiencePreview | null>(null), [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false), [conflict, setConflict] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; title: string; message: string } | null>(null);
  const lock = useRef(false), operation = useRef<string | null>(null);
  const context = resource.data, lesson = context?.lesson;
  const unit = lesson?.syllabus.units.find(value => value.unitId === lesson.unitId);
  const availableTopics = unit?.topics.filter(topic => lesson?.topicIds.includes(topic.topicId)) ?? [];
  const disabled = busy || conflict || resource.loading || !!resource.error || saved?.status === 'published';
  const addQuestion = (type: QuizQuestion['type']) => {
    const questionId = localId('question');
    if (type === 'multiple_choice') setQuestions(current => [...current, { questionId, type, text: '', options: [
      { optionId: localId('option'), text: '' }, { optionId: localId('option'), text: '' },
    ], correctOptionIds: [] }]);
    else if (type === 'true_false') setQuestions(current => [...current, { questionId, type, text: '', correctBoolean: true }]);
    else setQuestions(current => [...current, { questionId, type, text: '', expectedAnswer: '' }]);
  };
  const updateQuestion = (questionId: string, transform: (question: QuizQuestion) => QuizQuestion) =>
    setQuestions(current => current.map(question => question.questionId === questionId ? transform(question) : question));
  const valid = () => {
    const attempts = Number(attemptLimit), limit = timeLimit ? Number(timeLimit) : null;
    const invalidQuestion = questions.some(question => !question.text.trim() ||
      (question.type === 'multiple_choice' && (question.options.some(option => !option.text.trim()) || !question.correctOptionIds.length)));
    if (!title.trim() || !instructions.trim() || !topics.length || !questions.length || invalidQuestion ||
      !/^\d{4}-\d{2}-\d{2}$/.test(availableFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(availableUntil) ||
      availableUntil < availableFrom || !Number.isInteger(attempts) || attempts < 1 || attempts > 10 ||
      (limit !== null && (!Number.isInteger(limit) || limit < 1 || limit > 240))) {
      setFeedback({ kind: 'error', title: 'Complete the quiz draft', message: 'Provide valid topics, questions, answer keys, availability and attempt rules.' });
      return false;
    }
    return true;
  };
  const save = async () => {
    if (!accessToken || !lesson || lock.current || !valid()) return null;
    lock.current = true; setBusy(true); setFeedback(null);
    try {
      const body = { lessonPlanId: lesson.lessonPlanId, topicIds: topics, title, instructions, questions,
        availableFrom, availableUntil, attemptLimit: Number(attemptLimit),
        timeLimitMinutes: timeLimit ? Number(timeLimit) : undefined, shuffleQuestions: shuffle,
        ...(saved ? { revision: saved.revision } : {}), clientOperationId: academicWorkOperationId('quiz') };
      const result = await academicWorkService.saveQuiz(accessToken, body, saved?.quizId);
      setSaved(result);
      setFeedback({ kind: 'success', title: 'Quiz draft saved', message: `Server confirmed ${result.questions.length} questions in revision ${result.revision}.` });
      return result;
    } catch (error) {
      const stale = error instanceof ApiError && error.status === 409;
      if (stale) setConflict(true);
      setFeedback({ kind: 'error', title: stale ? 'Quiz revision conflict' : 'Unable to save quiz', message: `${error instanceof Error ? error.message : 'Please retry.'} Your questions have been retained.` });
      return null;
    } finally { lock.current = false; setBusy(false); }
  };
  const prepare = async () => {
    const current = await save();
    if (!current || !accessToken) return;
    try { const preview = await academicWorkService.previewQuiz(accessToken, current.quizId); setAudience(preview); setConfirmationDraft(current); setConfirm(true); }
    catch (error) { setFeedback({ kind: 'error', title: 'Unable to preview recipients', message: error instanceof Error ? error.message : 'Please retry.' }); }
  };
  const publish = async () => {
    if (!confirmationDraft || !accessToken || lock.current) return;
    lock.current = true; setBusy(true); setFeedback(null); operation.current ??= academicWorkOperationId('publish_quiz');
    try {
      const result = await academicWorkService.publishQuiz(accessToken, confirmationDraft.quizId, confirmationDraft.revision, operation.current);
      setSaved(result); setConfirmationDraft(null); setConfirm(false); operation.current = null;
      setFeedback({ kind: 'success', title: 'Quiz published successfully.', message: `${result.recipientCount} learners assigned • Available ${result.availableFrom} to ${result.availableUntil}.` });
    } catch (error) { setFeedback({ kind: 'error', title: 'Unable to publish quiz', message: `${error instanceof Error ? error.message : 'Please retry.'} Your draft has been retained.` }); }
    finally { lock.current = false; setBusy(false); }
  };
  return <DashboardShell safeArea={false} keyboardShouldPersistTaps="handled">
    <ScreenHeading title="Create Quiz" subtitle={lesson ? `${lesson.className} • Section ${lesson.sectionName} • ${lesson.syllabus.title}` : 'Lesson-linked assessment'} />
    <LoadState loading={resource.loading} error={resource.error} retry={resource.refresh} label="Loading lesson context..." />
    {feedback ? <AdminFeedback {...feedback} /> : null}
    {saved ? <StatusBadge status={saved.status === 'published' ? 'paid' : 'pending'} label={`${saved.status} • ${saved.questions.length} questions`} /> : null}
    {lesson ? <>
      <SectionCard title="1. Academic Context"><Text style={formStyles.copy}>{lesson.teacherName} • {lesson.className} • Section {lesson.sectionName}{'\n'}Approved lesson required for publication{lesson.occurrence?.isSubstitute ? ' • Exact substitute occurrence' : ''}</Text></SectionCard>
      <SectionCard title="2. Quiz Details">
        <Text style={formStyles.label}>Title</Text><TextInput accessibilityLabel="Quiz title" style={formStyles.input} value={title} onChangeText={setTitle} editable={!disabled} maxLength={200} />
        <Text style={formStyles.label}>Instructions</Text><TextInput accessibilityLabel="Quiz instructions" style={formStyles.input} value={instructions} onChangeText={setInstructions} editable={!disabled} multiline maxLength={8000} />
      </SectionCard>
      <SectionCard title="3. Topic Mapping">{availableTopics.map(topic => <Button key={topic.topicId} title={`${topics.includes(topic.topicId) ? 'Selected: ' : ''}${topic.title}`} variant="secondary" disabled={disabled} onPress={() => setTopics(current => current.includes(topic.topicId) ? current.filter(id => id !== topic.topicId) : [...current, topic.topicId])} />)}</SectionCard>
      <SectionCard title={`4. Questions • ${questions.length}`}>
        <Button title="Add Multiple Choice" variant="secondary" disabled={disabled} onPress={() => addQuestion('multiple_choice')} />
        <Button title="Add True / False" variant="secondary" disabled={disabled} onPress={() => addQuestion('true_false')} />
        <Button title="Add Short Answer" variant="secondary" disabled={disabled} onPress={() => addQuestion('short_answer')} />
        {questions.map((question, index) => <SectionCard key={question.questionId} title={`Question ${index + 1} • ${question.type.replaceAll('_', ' ')}`}>
          <TextInput accessibilityLabel={`Question ${index + 1} text`} style={formStyles.input} value={question.text} editable={!disabled} multiline onChangeText={text => updateQuestion(question.questionId, current => ({ ...current, text }))} />
          {question.type === 'multiple_choice' ? question.options.map((option, optionIndex) => <React.Fragment key={option.optionId}>
            <TextInput accessibilityLabel={`Question ${index + 1} option ${optionIndex + 1}`} style={formStyles.input} value={option.text} editable={!disabled} onChangeText={text => updateQuestion(question.questionId, current => current.type === 'multiple_choice' ? { ...current, options: current.options.map(value => value.optionId === option.optionId ? { ...value, text } : value) } : current)} />
            <Button title={`${question.correctOptionIds.includes(option.optionId) ? 'Correct: ' : 'Mark correct: '}${optionIndex + 1}`} variant="secondary" disabled={disabled} onPress={() => updateQuestion(question.questionId, current => current.type === 'multiple_choice' ? { ...current, correctOptionIds: [option.optionId] } : current)} />
          </React.Fragment>) : null}
          {question.type === 'true_false' ? <Button title={`Correct answer: ${question.correctBoolean ? 'True' : 'False'}`} variant="secondary" disabled={disabled} onPress={() => updateQuestion(question.questionId, current => current.type === 'true_false' ? { ...current, correctBoolean: !current.correctBoolean } : current)} /> : null}
          {question.type === 'short_answer' ? <TextInput accessibilityLabel={`Question ${index + 1} expected answer`} style={formStyles.input} value={question.expectedAnswer} editable={!disabled} multiline onChangeText={expectedAnswer => updateQuestion(question.questionId, current => current.type === 'short_answer' ? { ...current, expectedAnswer } : current)} /> : null}
          <Button title={`Remove Question ${index + 1}`} variant="secondary" disabled={disabled} onPress={() => setQuestions(current => current.filter(value => value.questionId !== question.questionId))} />
        </SectionCard>)}
      </SectionCard>
      <SectionCard title="5. Attempt Rules">
        <AdminDateField label="Available from" value={availableFrom} onChange={setAvailableFrom} disabled={disabled} helper="School-local release date. Students cannot see the quiz earlier." />
        <AdminDateField label="Available until" value={availableUntil} onChange={setAvailableUntil} disabled={disabled} helper="School-local final availability date." />
        <Text style={formStyles.label}>Attempt limit</Text><TextInput accessibilityLabel="Attempt limit" style={formStyles.input} value={attemptLimit} onChangeText={setAttemptLimit} editable={!disabled} keyboardType="number-pad" />
        <Text style={formStyles.label}>Time limit in minutes (optional)</Text><TextInput accessibilityLabel="Time limit" style={formStyles.input} value={timeLimit} onChangeText={setTimeLimit} editable={!disabled} keyboardType="number-pad" />
        <Button title={`Shuffle questions: ${shuffle ? 'Yes' : 'No'}`} variant="secondary" disabled={disabled} onPress={() => setShuffle(value => !value)} />
      </SectionCard>
      <SectionCard title="6. Audience"><Text style={formStyles.copy}>{lesson.className} • Section {lesson.sectionName}{'\n'}{audience?.recipientCount ?? context.audience.recipientCount} eligible students</Text><Text style={formStyles.helper}>The server re-resolves the roster atomically when publishing.</Text></SectionCard>
      {saved?.status !== 'published' ? <><Button title={busy ? 'Saving...' : 'Save Quiz Draft'} disabled={disabled} onPress={save} /><Button title="Review & Publish Quiz" disabled={disabled} onPress={prepare} /></> : null}
    </> : null}
    <AdminDialog visible={confirm} title="Publish Quiz" busy={busy} busyLabel="Publishing quiz" onClose={() => setConfirm(false)} onConfirm={publish} confirmTitle="Publish">
      <Text style={formStyles.copy}>{confirmationDraft?.title}{'\n'}{confirmationDraft?.instructions}{'\n'}{confirmationDraft?.questions.length ?? 0} questions • {lesson?.className} • Section {lesson?.sectionName}{'\n'}{availableTopics.filter(topic => confirmationDraft?.topicIds.includes(topic.topicId)).map(topic => topic.title).join(', ')}{'\n'}{confirmationDraft?.availableFrom} to {confirmationDraft?.availableUntil}{'\n'}Attempt limit {confirmationDraft?.attemptLimit}{confirmationDraft?.timeLimitMinutes ? ` • ${confirmationDraft.timeLimitMinutes} minutes` : ''}{'\n'}{audience?.recipientCount ?? 0} recipients</Text>
      <Text style={formStyles.helper}>Published questions and answer keys are frozen. Student reads never include answer keys.</Text>
    </AdminDialog>
  </DashboardShell>;
}
