import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../../../api/client';
import { Page, Card, Title, Muted, Button, ErrorText, Busy } from '../../../components/UI';

export default function ParentLectureDetailScreen({ route }) {
  const id = route.params.lectureId;
  const [lecture, setLecture] = useState(null),
    [attempts, setAttempts] = useState([]),
    [error, setError] = useState('');
  const load = useCallback(async () => {
    try {
      setLecture((await api('/parent/lectures/' + id)).item);
      setAttempts((await api(`/parent/lectures/${id}/attempts`)).items);
    } catch (e) {
      setError(e.message);
    }
  }, [id]);
  useEffect(() => {
    load();
  }, [load]);
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
          <Muted>{q.options.map((o, j) => `${j + 1}. ${o}`).join('\n')}</Muted>
        </Card>
      ))}
      <Title>Quiz results</Title>
      {!attempts.length && <Muted>No quiz attempt yet.</Muted>}
      {attempts.map(a => (
        <Card key={a._id}>
          <Title>{a.studentId?.name}</Title>
          <Muted>Score: {a.score}/{a.total}</Muted>
        </Card>
      ))}
    </Page>
  );
}
