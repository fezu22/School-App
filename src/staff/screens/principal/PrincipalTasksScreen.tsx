import React, { useCallback, useRef, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  Button,
  SectionCard,
  ScreenHeading,
} from '../../components/hiraDashboard';
import { DashboardShell } from '../../components/hiraDashboard/DashboardShell';
import { useAuth } from '../../context/AuthContext';
import type { PrincipalStackParamList } from '../../navigation/PrincipalNavigator';
import {
  principalService,
  PrincipalTask,
  TaskStatus,
  TaskPriority,
} from '../../services/principal/principalService';
import {
  taskStatuses,
  taskPriorities,
  taskLabel,
  taskDueDate,
  taskTime,
  taskError,
  taskStyles as styles,
} from './taskUi';

type Props = NativeStackScreenProps<PrincipalStackParamList, 'Tasks'>;

export default function PrincipalTasksScreen({ navigation }: Props) {
  const { accessToken } = useAuth();
  const [tasks, setTasks] = useState<PrincipalTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [canAssign, setCanAssign] = useState(false);
  const [status, setStatus] = useState<TaskStatus | undefined>();
  const [priority, setPriority] = useState<TaskPriority | undefined>();
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const generation = useRef(0);
  const cancelLoads = useCallback(() => {
    ++generation.current;
  }, []);
  const load = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true);
    setError(null);
    setCanAssign(false);
    try {
      if (!accessToken)
        throw new Error('Your session is unavailable. Sign in again.');
      const result = await principalService.getTasks(accessToken, {
        status,
        priority,
        ...(search ? { search } : {}),
      });
      if (current !== generation.current) return;
      setTasks(result.data);
      setCanAssign(result.canAssign);
    } catch (loadError) {
      if (current === generation.current) setError(taskError(loadError));
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }, [accessToken, status, priority, search]);
  useFocusEffect(
    useCallback(() => {
      load().catch(() => undefined);
      return cancelLoads;
    }, [load, cancelLoads]),
  );

  return (
    <DashboardShell refreshing={loading} onRefresh={load}>
      <Button
        title="Back"
        variant="secondary"
        onPress={() => navigation.goBack()}
      />
      <ScreenHeading
        title="Tasks"
        subtitle="Assign and track tasks in your branch"
      />
      {canAssign ? (
        <Button
          title="Assign task"
          onPress={() => navigation.navigate('AssignTask')}
        />
      ) : null}
      <SectionCard title="Task list">
        <TextInput
          accessibilityLabel="Search task title"
          value={searchInput}
          onChangeText={setSearchInput}
          maxLength={150}
          placeholder="Search task title"
          style={styles.input}
        />
        <Button
          title="Search tasks"
          variant="secondary"
          onPress={() => setSearch(searchInput.trim())}
        />
        <Text style={styles.muted}>Status</Text>
        <View style={styles.filters}>
          <Button
            title="All statuses"
            variant={!status ? 'primary' : 'secondary'}
            onPress={() => setStatus(undefined)}
          />
          {taskStatuses.map(value => (
            <Button
              key={value}
              title={taskLabel(value)}
              variant={status === value ? 'primary' : 'secondary'}
              onPress={() => setStatus(value)}
            />
          ))}
        </View>
        <Text style={styles.muted}>Priority</Text>
        <View style={styles.filters}>
          <Button
            title="All priorities"
            variant={!priority ? 'primary' : 'secondary'}
            onPress={() => setPriority(undefined)}
          />
          {taskPriorities.map(value => (
            <Button
              key={value}
              title={taskLabel(value)}
              variant={priority === value ? 'primary' : 'secondary'}
              onPress={() => setPriority(value)}
            />
          ))}
        </View>
        {loading ? (
          <Text style={styles.muted}>Loading tasks...</Text>
        ) : error ? (
          <View>
            <Text accessibilityRole="alert" style={styles.error}>
              {error}
            </Text>
            <Button title="Retry tasks" onPress={load} />
          </View>
        ) : tasks.length === 0 ? (
          <Text style={styles.muted}>No tasks match the current filters.</Text>
        ) : (
          tasks.map(task => (
            <View key={task._id} style={styles.actions}>
              <Text style={styles.body}>{task.title}</Text>
              <Text style={styles.muted}>
                {task.assignee?.fullName || 'Unavailable assignee'} ·{' '}
                {taskLabel(task.status)} · {taskLabel(task.priority)}
              </Text>
              {task.dueDate ? (
                <Text style={styles.muted}>
                  Due: {taskDueDate(task.dueDate)}
                </Text>
              ) : null}
              <Text style={styles.muted}>
                Updated: {taskTime(task.updatedAt)}
              </Text>
              <Button
                title={`Open task: ${task.title}`}
                variant="secondary"
                onPress={() =>
                  navigation.navigate('TaskDetail', { taskId: task._id })
                }
              />
            </View>
          ))
        )}
      </SectionCard>
    </DashboardShell>
  );
}
