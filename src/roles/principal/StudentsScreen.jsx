import React, { useCallback, useState } from 'react';
import { RefreshControl } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getPrincipalStudents } from '../../api/principal';
import { useAuth } from '../../auth/AuthContext';
import {
  Busy,
  Button,
  Card,
  Empty,
  ErrorText,
  Label,
  Muted,
  Page,
  Title,
} from '../../components/UI';

export default function StudentsScreen() {
  const { signOut, isDevMode } = useAuth();
  const [items, setItems] = useState([]);
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (isDevMode) {
      setItems([]);
      setError('Preview mode has no API session. Sign in with a school account to load live data.');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');
    try {
      const result = await getPrincipalStudents();
      setItems(result.items);
      setBranches(result.branches);
    } catch (cause) {
      if (cause.status === 401) {
        setError('Your session has expired. Sign in again to continue.');
        await signOut();
      } else if (cause.status === 403) {
        setError('You do not have access to the student directory.');
      } else if (cause.status === 404) {
        setError('The student directory is not available right now.');
      } else if (cause.status >= 500) {
        setError('The student directory could not be loaded. Please try again.');
      } else {
        setError(cause.message || 'Could not connect. Check your connection and retry.');
      }
    } finally {
      setLoading(false);
    }
  }, [isDevMode, signOut]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const branchNames = new Map(branches.map(branch => [String(branch._id), branch.name]));

  return (
    <Page refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
      <Title>Students</Title>
      <Muted>Students assigned to your branches</Muted>
      <ErrorText message={error} />
      {loading ? (
        <Busy />
      ) : !items.length ? (
        <Empty text="No students are assigned to your branches." />
      ) : (
        items.map(student => {
          const branchId = student.branchId?._id || student.branchId;
          const branchName = student.branchId?.name || branchNames.get(String(branchId));
          const className = [student.classId?.name, student.classId?.section]
            .filter(Boolean)
            .join(' ');

          return (
            <Card key={student._id}>
              <Label>{student.name}</Label>
              <Muted>
                {student.admissionNumber ? `${student.admissionNumber}\n` : ''}
                {className ? `Class: ${className}\n` : ''}
                {branchName ? `Branch: ${branchName}\n` : ''}
                {typeof student.active === 'boolean'
                  ? `Status: ${student.active ? 'Active' : 'Inactive'}`
                  : ''}
              </Muted>
            </Card>
          );
        })
      )}
      {!!error && <Button title="Retry" onPress={load} secondary />}
    </Page>
  );
}