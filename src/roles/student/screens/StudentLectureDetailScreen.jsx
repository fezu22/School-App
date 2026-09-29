import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../../../api/client';
import { Page, Card, Title, Muted, Choice, Button, ErrorText, Busy } from '../../../components/UI';

export default function StudentLectureDetailScreen({ route }) {
  const id = route.params.lectureId;
  const [lecture, setLecture] = useState(null),
    [attempts, setAttempts] = useState([]),
    [answers, setAnswers] = useState({}),
    [feedback, setFeedback] = useState([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const load = useCallback(async () => {
    try {
      setLecture((await api('/student/lectures/' + id)).item);
      setAttempts((await api(`/student/lectures/${id}/attempts`)).items);
    } catch (e) {
      setError(e.message);
    }
  }, [id]);
  useEffect(() => {
    load();
  }, [load]);
  async function submitQuiz() {
    if (lecture.questions.some((_, i) => answers[i] === undefined))
      return setError('Answer every question');
    setBusy(true);
    setError('');
    try {
      const d = await api(`/student/lectures/${id}/attempts`, 'POST', {
        answers: lecture.questions.map((_, i) => answers[i]),
      });
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
      <Muted>{lecture.subject}</Muted>
      <ErrorText message={error} />
      {lecture.summary && (
        <Card>
          <Title>Summary</Title>
          <Muted>{lecture.summary}</Muted>
          <Muted>{(lecture.topics || []).join(' · ')}</Muted>
        </Card>
      )}
      {lecture.homework && (
        <Card>
          <Title>Homework</Title>
          <Muted>{lecture.homework}</Muted>
        </Card>
      )}
      {lecture.questions?.map((q, i) => (
        <Card key={i}>
          <Title>Question {i + 1}</Title>
          <Muted>{q.prompt}</Muted>
          {attempts.length ? (
            <Muted>{q.options.map((o, j) => `${j + 1}. ${o}`).join('\n')}</Muted>
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
      {lecture.state === 'PUBLISHED' && !attempts.length && (
        <Button title="Submit quiz for automatic checking" onPress={submitQuiz} busy={busy} />
      )}
      {attempts.map(a => (
        <Card key={a._id}>
          <Title>Your score</Title>
          <Muted>{a.score}/{a.total}</Muted>
        </Card>
      ))}
      {feedback.map((f, i) => (
        <Card key={i}>
          <Title>Q{i + 1}: {f.correct ? 'Correct' : 'Needs revision'}</Title>
          <Muted>{f.explanation}</Muted>
        </Card>
      ))}
    </Page>
  );
}
