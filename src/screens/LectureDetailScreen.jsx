import React, { useEffect, useState, useCallback } from 'react';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import {
  Page,
  Card,
  Title,
  Muted,
  Field,
  Choice,
  Button,
  ErrorText,
  Busy,
} from '../components/UI';
export default function LectureDetailScreen({ route }) {
  const id = route.params.lectureId;
  const { user } = useAuth();
  const staff = ['SUPER_ADMIN', 'PRINCIPAL', 'TEACHER'].includes(user.role);
  const [lecture, setLecture] = useState(null),
    [attempts, setAttempts] = useState([]),
    [answers, setAnswers] = useState({}),
    [summary, setSummary] = useState(''),
    [homework, setHomework] = useState(''),
    [dueDate, setDueDate] = useState(''),
    [maxMarks, setMaxMarks] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [feedback, setFeedback] = useState([]);
  const load = useCallback(async () => {
    try {
      const d = await api('/lectures/' + id);
      setLecture(d.item);
      setSummary(d.item.summary || '');
      setHomework(d.item.homework || '');
      setAttempts((await api(`/lectures/${id}/attempts`)).items);
    } catch (e) {
      setError(e.message);
    }
  }, [id]);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    if (lecture?.state !== 'PROCESSING') return;
    const timer = setInterval(load, 4000);
    return () => clearInterval(timer);
  }, [lecture?.state, load]);
  async function action(path, body) {
    setBusy(true);
    setError('');
    try {
      const d = await api(`/lectures/${id}/${path}`, 'POST', body);
      if (d.feedback) setFeedback(d.feedback);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  if (!lecture)
    return (
      <Page>
        <ErrorText message={error} />
        <Busy />
        <Button title="Retry" onPress={load} />
      </Page>
    );
  return (
    <Page>
      <Title>{lecture.title}</Title>
      <Muted>
        {lecture.subject} · {lecture.state}
      </Muted>
      <ErrorText message={error || lecture.failure} />
      {staff && ['DRAFT', 'FAILED', 'READY'].includes(lecture.state) && (
        <Button
          title={
            lecture.state === 'READY'
              ? 'Regenerate draft'
              : 'Generate summary, homework & quiz'
          }
          onPress={() => action('generate')}
          busy={busy}
        />
      )}{' '}
      {lecture.state === 'PROCESSING' && (
        <Card>
          <Busy />
          <Muted>Processing transcript. You can leave and return.</Muted>
        </Card>
      )}
      {lecture.summary && (
        <Card>
          <Title>Summary</Title>
          {staff && lecture.state === 'READY' ? (
            <Field
              label="Review summary"
              value={summary}
              onChangeText={setSummary}
              multiline
            />
          ) : (
            <Muted>{lecture.summary}</Muted>
          )}
          <Muted>{lecture.topics.join(' · ')}</Muted>
        </Card>
      )}
      {lecture.homework && (
        <Card>
          <Title>Homework</Title>
          {staff && lecture.state === 'READY' ? (
            <Field
              label="Review homework"
              value={homework}
              onChangeText={setHomework}
              multiline
            />
          ) : (
            <Muted>{lecture.homework}</Muted>
          )}
        </Card>
      )}
      {lecture.questions?.map((q, i) => (
        <Card key={i}>
          <Title>Question {i + 1}</Title>
          <Muted>{q.prompt}</Muted>
          {staff || user.role === 'PARENT' || attempts.length ? (
            <>
              <Muted>
                {q.options.map((o, j) => `${j + 1}. ${o}`).join('\n')}
              </Muted>
              {staff && (
                <Muted>
                  Answer: {q.correctIndex + 1}
                  {'\n'}
                  {q.explanation}
                </Muted>
              )}
            </>
          ) : (
            <Choice
              label="Answer"
              options={q.options.map((v, j) => ({ value: j, label: v }))}
              value={answers[i]}
              onChange={v => setAnswers(a => ({ ...a, [i]: v }))}
            />
          )}
        </Card>
      ))}
      {staff && lecture.state === 'READY' && (
        <Card>
          <Muted>
            Review every question and answer. Regenerate if incorrect.
          </Muted>
          <Field
            label="Homework due (YYYY-MM-DD)"
            value={dueDate}
            onChangeText={setDueDate}
          />
          <Field
            label="Homework maximum marks"
            value={maxMarks}
            onChangeText={setMaxMarks}
            keyboardType="numeric"
          />
          <Button
            title="Approve & publish lesson, homework and quiz"
            onPress={() =>
              action('publish', {
                summary,
                homework,
                dueDate,
                maxMarks: Number(maxMarks),
              })
            }
            busy={busy}
          />
        </Card>
      )}
      {user.role === 'STUDENT' &&
        lecture.state === 'PUBLISHED' &&
        !attempts.length && (
          <Button
            title="Submit quiz for automatic checking"
            onPress={() =>
              lecture.questions.some((_, i) => answers[i] === undefined)
                ? setError('Answer every question')
                : action('attempts', {
                    answers: lecture.questions.map((_, i) => answers[i]),
                  })
            }
            busy={busy}
          />
        )}{' '}
      {attempts.map(a => (
        <Card key={a._id}>
          <Title>{a.studentId?.name}</Title>
          <Muted>
            Score: {a.score}/{a.total}
          </Muted>
        </Card>
      ))}
      {feedback.map((f, i) => (
        <Card key={i}>
          <Title>
            Q{i + 1}: {f.correct ? 'Correct' : 'Needs revision'}
          </Title>
          <Muted>{f.explanation}</Muted>
        </Card>
      ))}
    </Page>
  );
}
