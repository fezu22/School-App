import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../../../api/client';
import { Page, Card, Title, Muted, Field, Button, ErrorText, Empty } from '../../../components/UI';

export default function StudentAssignmentDetailScreen({ route }) {
  const assignment = route.params.assignment;
  const [items, setItems] = useState([]),
    [answer, setAnswer] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      setItems((await api(`/student/assignments/${assignment._id}/submissions`)).items);
    } catch (e) {
      setError(e.message);
    }
  }, [assignment._id]);
  useEffect(() => {
    load();
  }, [load]);
  async function submit() {
    setBusy(true);
    try {
      await api(`/student/assignments/${assignment._id}/submissions`, 'POST', { answer });
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Page>
      <Title>{assignment.title}</Title>
      <Muted>{assignment.subject} · Due {assignment.dueDate} · {assignment.maxMarks} marks</Muted>
      <Card><Muted>{assignment.instructions}</Muted></Card>
      <ErrorText message={error} />
      {!items.length && (
        <Card>
          <Field label="Your answer" value={answer} onChangeText={setAnswer} multiline />
          <Button title="Submit answer" onPress={submit} busy={busy} />
        </Card>
      )}
      <Title>My submission</Title>
      {!items.length && <Empty text="Not submitted yet." />}
      {items.map(item => (
        <Card key={item._id}>
          <Muted>{item.answer}</Muted>
          <Muted>
            {item.marks === undefined ? 'Awaiting review' : `Marks: ${item.marks}/${assignment.maxMarks}`}
            {'\n'}{item.feedback}
          </Muted>
        </Card>
      ))}
    </Page>
  );
}
