import React, {useCallback, useEffect, useRef, useState} from 'react';
import {Text, TextInput} from 'react-native';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import type {TeacherStackParamList} from '../../navigation/TeacherNavigator';
import {Button, DashboardShell, ScreenHeading, SectionCard, StatusBadge} from '../../components/hiraDashboard';
import {AdminFeedback, formStyles} from '../../components/hiraDashboard/AdminForm';
import {useAuth} from '../../context/AuthContext';
import {academicReviewService, reviewOperationId, type ReviewDetail} from '../../services/teacher/academicReviewService';
import {useTeacherResource} from './useTeacherResource';
import {LoadState, styles} from './teacherUi';

export default function TeacherReviewScreen({route}: NativeStackScreenProps<TeacherStackParamList, 'TeacherReview'>) {
  const {accessToken} = useAuth(), {targetType, evidenceId} = route.params;
  const load = useCallback(() => accessToken ? academicReviewService.detail(accessToken, targetType, evidenceId) : Promise.reject(new Error('Authentication required')),
    [accessToken, evidenceId, targetType]);
  const resource = useTeacherResource(load);
  const [current, setCurrent] = useState<ReviewDetail | null>(null), [score, setScore] = useState(''), [maxScore, setMaxScore] = useState('10');
  const [feedback, setFeedback] = useState(''), [privateNote, setPrivateNote] = useState(''), [returnReason, setReturnReason] = useState('');
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState<{kind: 'success' | 'error'; title: string; message: string} | null>(null);
  const lock = useRef(false); const detail = current ?? resource.data;
  const evidenceStatus = String(detail?.evidence?.status ?? '');
  const canEditReview = targetType === 'homework_submission'
    ? ['submitted', 'resubmitted', 'under_review'].includes(evidenceStatus)
    : ['submitted', 'under_review'].includes(evidenceStatus);
  useEffect(() => {
    if (!resource.data) return;
    setFeedback(resource.data.review?.feedback ?? ''); setPrivateNote(resource.data.review?.privateNote ?? '');
    setScore(resource.data.review?.scores[0] ? String(resource.data.review.scores[0].score) : '');
    if (resource.data.rubric?.criteria[0]) setMaxScore(String(resource.data.rubric.criteria[0].maxScore));
  }, [resource.data]);
  const mutate = async (action: 'save_draft' | 'finalize' | 'return_for_resubmission' | 'release_feedback') => {
    if (!accessToken || !detail || lock.current) return;
    const points = Number(score), maximum = Number(maxScore);
    if ((action === 'save_draft' || action === 'finalize') && (!Number.isFinite(points) || points < 0 || !Number.isFinite(maximum) || maximum <= 0 || points > maximum)) {
      setNotice({kind: 'error', title: 'Check rubric scores', message: 'Scores must be numeric, non-negative, and within the criterion maximum.'}); return;
    }
    if (action === 'return_for_resubmission' && returnReason.trim().length < 3) {
      setNotice({kind: 'error', title: 'Return reason required', message: 'Explain what the learner should revise.'}); return;
    }
    lock.current = true; setBusy(true); setNotice(null);
    try {
      const body: Record<string, unknown> = {action, revision: detail.review?.revision ?? 0, clientOperationId: reviewOperationId(action)};
      if (action === 'save_draft' || action === 'finalize') Object.assign(body, {
        ...(detail.rubric ? {} : {criteria: [{criterionId: 'overall', title: 'Overall quality', description: 'Evidence meets the assigned learning objective.', maxScore: maximum}]}),
        ...(detail.rubric ? {} : {rubricRevision: undefined}), scores: [{criterionId: detail.rubric?.criteria[0]?.criterionId ?? 'overall', score: points}],
        feedback, privateNote,
      });
      if (action === 'return_for_resubmission') Object.assign(body, {returnReason, resubmitAllowed: true});
      const result = await academicReviewService.mutate(accessToken, targetType, evidenceId, body);
      setCurrent({...detail, ...result}); setNotice({kind: 'success', title: action === 'release_feedback' ? 'Feedback released' :
        action === 'return_for_resubmission' ? 'Returned for resubmission' : action === 'finalize' ? 'Review finalized' : 'Review draft saved',
      message: action === 'release_feedback' ? 'The learner can now see released feedback and scores.' : 'Server-confirmed review history was preserved.'});
    } catch (error) {
      setNotice({kind: 'error', title: 'Review was not changed', message: error instanceof Error ? error.message : 'Refresh and retry.'});
    } finally {lock.current = false; setBusy(false);}
  };
  const evidence = detail?.evidence;
  return <DashboardShell refreshing={resource.loading} onRefresh={resource.refresh} keyboardShouldPersistTaps="handled">
    <ScreenHeading title="Submission Review" subtitle={detail ? `${detail.work.title} • ${detail.student.fullName}` : 'Secure learner evidence'} />
    <LoadState {...resource} retry={resource.refresh} label="Loading learner evidence..." />
    {notice ? <AdminFeedback {...notice} /> : null}
    {detail ? <>
      <SectionCard title="Academic Context"><Text style={styles.body}>{detail.work.className} • Section {detail.work.sectionName} • {detail.work.subjectName}</Text>
        <Text style={styles.muted}>Published revision {detail.work.publishedRevision}</Text></SectionCard>
      <SectionCard title="Submission Evidence"><StatusBadge status="pending" label={String(evidence?.status ?? '').replaceAll('_', ' ')} />
        <Text style={styles.body}>{detail.student.fullName} • {detail.student.admissionNumber}</Text>
        {'revisions' in (evidence ?? {}) ? (evidence as any).revisions.map((item: any) => <Text key={item.revision} style={styles.body}>Revision {item.revision} • {item.timing}{'\n'}{item.content}</Text>) :
          <Text style={styles.body}>Attempt {evidence?.attemptNumber} • Objective evidence {evidence?.objectiveScore}/{evidence?.objectiveMax}{'\n'}{evidence?.requiresManualReview ? 'Short answer requires Teacher review.' : 'Objective questions scored deterministically.'}</Text>}
      </SectionCard>
      <SectionCard title="Rubric / Score"><Text style={formStyles.label}>Maximum score</Text><TextInput accessibilityLabel="Maximum score" style={formStyles.input}
        value={detail.rubric ? String(detail.rubric.criteria[0]?.maxScore ?? '') : maxScore} editable={canEditReview && !detail.rubric && !busy} keyboardType="decimal-pad" onChangeText={setMaxScore} />
        <Text style={formStyles.label}>Score</Text><TextInput accessibilityLabel="Criterion score" style={formStyles.input} value={score} editable={canEditReview && !busy} keyboardType="decimal-pad" onChangeText={setScore} /></SectionCard>
      <SectionCard title="Feedback"><TextInput accessibilityLabel="Learner feedback" style={formStyles.input} value={feedback} editable={canEditReview && !busy} multiline onChangeText={setFeedback} />
        <TextInput accessibilityLabel="Teacher private note" style={formStyles.input} value={privateNote} editable={canEditReview && !busy} multiline onChangeText={setPrivateNote} /></SectionCard>
      <SectionCard title="History">{detail.review?.history.length ? detail.review.history.map(item => <Text key={item.revision} style={styles.body}>Revision {item.revision} • {item.action.replaceAll('_', ' ')}</Text>) : <Text style={styles.muted}>No review actions yet.</Text>}</SectionCard>
      {canEditReview && (!detail.review || !['reviewed', 'feedback_released'].includes(detail.review.state)) ? <>
        <Button title={busy ? 'Saving...' : 'Save Review Draft'} disabled={busy} onPress={() => mutate('save_draft')} />
        <Button title="Finalize Review" disabled={busy} onPress={() => mutate('finalize')} />
        {targetType === 'homework_submission' ? <SectionCard title="Return for Resubmit"><TextInput accessibilityLabel="Return reason" style={formStyles.input} value={returnReason} editable={!busy} multiline onChangeText={setReturnReason} />
          <Button title="Return for Resubmit" variant="secondary" disabled={busy} onPress={() => mutate('return_for_resubmission')} /></SectionCard> : null}
      </> : null}
      {detail.review?.state === 'reviewed' ? <Button title="Release Feedback" disabled={busy} onPress={() => mutate('release_feedback')} /> : null}
    </> : null}
  </DashboardShell>;
}
