import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  Button,
  SectionCard,
  ScreenHeading,
} from '../../components/hiraDashboard';
import { DashboardShell } from '../../components/hiraDashboard/DashboardShell';
import { useAuth } from '../../context/AuthContext';
import type { PrincipalStackParamList } from '../../navigation/PrincipalNavigator';
import { ApiError } from '../../services/api/apiClient';
import {
  principalService,
  TaskUser,
  TaskPriority,
} from '../../services/principal/principalService';
import {
  taskPriorities,
  taskLabel,
  taskCalendarDate,
  taskError,
  taskStyles as styles,
} from './taskUi';

type Props = NativeStackScreenProps<PrincipalStackParamList, 'AssignTask'>;

export default function AssignPrincipalTaskScreen({ navigation }: Props) {
  const { accessToken } = useAuth();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('normal');
  const [year, setYear] = useState('');
  const [month, setMonth] = useState('');
  const [day, setDay] = useState('');
  const [assignees, setAssignees] = useState<TaskUser[]>([]);
  const [selected, setSelected] = useState<TaskUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lock = useRef(false);
  const generation = useRef(0);
  const cancelLoads = useCallback(() => {
    ++generation.current;
  }, []);
  const load = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true);
    setError(null);
    setSelected(null);
    setAssignees([]);
    try {
      if (!accessToken)
        throw new Error('Your session is unavailable. Sign in again.');
      const result = await principalService.getTaskAssignees(accessToken);
      if (current === generation.current) setAssignees(result.data);
    } catch (loadError) {
      if (current === generation.current) setError(taskError(loadError));
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }, [accessToken]);
  useEffect(() => {
    load().catch(() => undefined);
    return cancelLoads;
  }, [load, cancelLoads]);

  const submit = async () => {
    if (!accessToken || lock.current || loading || uncertain) return;
    if (title.trim().length < 2 || title.trim().length > 150) {
      setError('Enter a task title of 2 to 150 characters.');
      return;
    }
    if (description.trim().length > 2000) {
      setError('Description must be at most 2000 characters.');
      return;
    }
    if (!selected || !assignees.some(user => user._id === selected._id)) {
      setError('Choose an eligible assignee.');
      return;
    }
    let dueDate: string | undefined;
    try {
      dueDate = taskCalendarDate(year, month, day);
    } catch (dateError) {
      setError(
        dateError instanceof Error ? dateError.message : 'Invalid due date.',
      );
      return;
    }
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await principalService.createTask(accessToken, {
        title: title.trim(),
        assignedTo: selected._id,
        priority,
        ...(description.trim() ? { description: description.trim() } : {}),
        ...(dueDate ? { dueDate } : {}),
      });
      navigation.replace('TaskDetail', {
        taskId: result.data._id,
        createdMessage: result.message,
      });
    } catch (createError) {
      if (!(createError instanceof ApiError) || createError.status >= 500) {
        setUncertain(true);
        setError(
          `${taskError(
            createError,
          )} The task may have been created. Check Tasks before submitting again.`,
        );
      } else {
        setError(taskError(createError));
      }
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };

  return (
    <DashboardShell>
      <Button
        title="Back to tasks"
        variant="secondary"
        disabled={busy}
        onPress={() => navigation.goBack()}
      />
      <ScreenHeading
        title="Assign task"
        subtitle="Create a task for an eligible person in your branch"
      />
      <SectionCard title="Task information">
        <TextInput
          accessibilityLabel="Task title"
          placeholder="Title (required)"
          value={title}
          onChangeText={setTitle}
          maxLength={150}
          editable={!busy}
          style={styles.input}
        />
        <TextInput
          accessibilityLabel="Task description"
          placeholder="Description (optional)"
          value={description}
          onChangeText={setDescription}
          maxLength={2000}
          multiline
          editable={!busy}
          style={styles.input}
        />
        <Text style={styles.body}>Priority</Text>
        <View style={styles.filters}>
          {taskPriorities.map(value => (
            <Button
              key={value}
              title={taskLabel(value)}
              disabled={busy}
              variant={priority === value ? 'primary' : 'secondary'}
              onPress={() => setPriority(value)}
            />
          ))}
        </View>
        <Text style={styles.body}>Due date (optional)</Text>
        <Text style={styles.muted}>
          Use year, month and day. Past dates and today are allowed. Dates are
          stored at UTC midnight.
        </Text>
        <TextInput
          accessibilityLabel="Due year"
          placeholder="Year: YYYY"
          value={year}
          onChangeText={setYear}
          keyboardType="number-pad"
          maxLength={4}
          editable={!busy}
          style={styles.input}
        />
        <TextInput
          accessibilityLabel="Due month"
          placeholder="Month: MM"
          value={month}
          onChangeText={setMonth}
          keyboardType="number-pad"
          maxLength={2}
          editable={!busy}
          style={styles.input}
        />
        <TextInput
          accessibilityLabel="Due day"
          placeholder="Day: DD"
          value={day}
          onChangeText={setDay}
          keyboardType="number-pad"
          maxLength={2}
          editable={!busy}
          style={styles.input}
        />
      </SectionCard>
      <SectionCard title="Assignee">
        {loading ? (
          <Text style={styles.muted}>Loading eligible assignees...</Text>
        ) : null}
        {!loading && !error && !assignees.length ? (
          <Text style={styles.muted}>No eligible assignees are available.</Text>
        ) : null}
        <View style={styles.actions}>
          {assignees.map(person => (
            <Button
              key={person._id}
              title={`${person.fullName} (${taskLabel(person.role)})`}
              variant={selected?._id === person._id ? 'primary' : 'secondary'}
              disabled={busy || loading || uncertain}
              onPress={() => setSelected(person)}
            />
          ))}
        </View>
        {selected ? (
          <Text style={styles.body}>
            Selected: {selected.fullName} ({taskLabel(selected.role)})
          </Text>
        ) : null}
        {selected?.role === 'teacher' ? (
          <Text style={styles.muted}>
            Teacher task self-service is unavailable. You can track and update
            the task as its creator.
          </Text>
        ) : null}
        <Button
          title="Refresh assignees"
          variant="secondary"
          disabled={busy || loading || uncertain}
          onPress={load}
        />
      </SectionCard>
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
      <Button
        title={busy ? 'Assigning task...' : 'Confirm assignment'}
        disabled={busy || loading || uncertain || !assignees.length}
        onPress={submit}
      />
      {uncertain ? (
        <Button
          title="Check Tasks"
          variant="secondary"
          onPress={() => navigation.goBack()}
        />
      ) : null}
    </DashboardShell>
  );
}
