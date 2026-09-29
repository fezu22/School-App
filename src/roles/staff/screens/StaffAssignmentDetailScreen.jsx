import React, { useState, useEffect, useCallback } from 'react';
import { Alert } from 'react-native';
import { api } from '../../../api/client';
import { useAuth } from '../../../auth/AuthContext';
import {
  Page,
  Card,
  Title,
  Muted,
  Field,
  Button,
  ErrorText,
  Empty,
} from '../../../components/UI';
function Review({ submission, maxMarks, onSave, onAI }) {
  const [marks, setMarks] = useState(
      submission.marks === undefined ? '' : String(submission.marks),
    ),
    [feedback, setFeedback] = useState(submission.feedback || '');
  return (
    <>
      <Button
        title={
          submission.aiState === 'PROCESSING'
            ? 'AI checking...'
            : 'Check with AI'
        }
        onPress={onAI}
        busy={submission.aiState === 'PROCESSING'}
      />
      {submission.aiState === 'FAILED' && (
        <ErrorText message="AI checking failed. Retry or review manually." />
      )}
      {submission.aiState === 'READY' && (
        <Card>
          <Muted>
            AI suggestion: {submission.aiMarks}/{maxMarks}
            {'\n'}
            {submission.aiFeedback}
          </Muted>
          <Button
            title="Use AI suggestion for review"
            secondary
            onPress={() => {
              setMarks(String(submission.aiMarks));
              setFeedback(submission.aiFeedback);
            }}
          />
        </Card>
      )}
      <Field
        label={`Marks (0–${maxMarks})`}
        value={marks}
        onChangeText={setMarks}
        keyboardType="numeric"
      />
      <Field
        label="Feedback"
        value={feedback}
        onChangeText={setFeedback}
        multiline
      />
      <Button
        title="Save review"
        onPress={() => onSave(Number(marks), feedback, marks)}
      />
    </>
  );
}
export default function StaffAssignmentDetailScreen({ route }) {
  const [assignment, setAssignment] = useState(route.params.assignment);
  const { user } = useAuth();
  const [items, setItems] = useState([]),
    [answer, setAnswer] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const staff = ['SUPER_ADMIN', 'PRINCIPAL', 'TEACHER'].includes(user.role);
  const load = useCallback(async () => {
    try {
      setItems((await api(`/staff/assignments/${assignment._id}/submissions`)).items);
    } catch (e) {
      setError(e.message);
    }
  }, [assignment._id]);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    if (!items.some(i => i.aiState === 'PROCESSING')) return;
    const timer = setInterval(load, 4000);
    return () => clearInterval(timer);
  }, [items, load]);
  async function checkAI(item) {
    try {
      await api(
        `/staff/assignments/${assignment._id}/submissions/${item._id}/ai-review`,
        'POST',
      );
      await load();
    } catch (e) {
      setError(e.message);
    }
  }
  async function publish() {
    setBusy(true);
    try {
      const d = await api(`/staff/assignments/${assignment._id}/publish`, 'PATCH', {
        published: !assignment.published,
      });
      setAssignment(d.item);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function submit() {
    setBusy(true);
    try {
      await api(`/staff/assignments/${assignment._id}/submissions`, 'POST', {
        answer,
      });
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function grade(item, marks, feedback, raw) {
    if (!raw) return setError('Enter marks');
    try {
      await api(
        `/staff/assignments/${assignment._id}/submissions/${item._id}`,
        'PATCH',
        { marks, feedback },
      );
      await load();
      Alert.alert('Saved', 'Feedback is available to the student');
    } catch (e) {
      setError(e.message);
    }
  }
  return (
    <Page>
      <Title>{assignment.title}</Title>
      <Muted>
        {assignment.subject} · Due {assignment.dueDate} · {assignment.maxMarks}{' '}
        marks
      </Muted>
      <Card>
        <Muted>{assignment.instructions}</Muted>
      </Card>
      <ErrorText message={error} />
      {staff && (
        <Button
          title={
            assignment.published ? 'Unpublish' : 'Publish to assigned class'
          }
          onPress={publish}
          busy={busy}
        />
      )}{' '}
      <Title>Submissions</Title>
      {!items.length && <Empty text="No submissions yet." />}
      {items.map(item => (
        <Card key={item._id}>
          <Title>{item.studentId?.name}</Title>
          <Muted>{item.answer}</Muted>
          <Muted>
            {item.marks === undefined
              ? 'Awaiting review'
              : `Marks: ${item.marks}/${assignment.maxMarks}`}
            {'\n'}
            {item.feedback}
          </Muted>
          {staff && (
            <Review
              submission={item}
              onAI={() => checkAI(item)}
              maxMarks={assignment.maxMarks}
              onSave={(m, f, r) => grade(item, m, f, r)}
            />
          )}
        </Card>
      ))}
    </Page>
  );
}
