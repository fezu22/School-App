import React, { useCallback, useRef, useState } from 'react';
import { Text, View } from 'react-native';
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
  TaskAction,
} from '../../services/principal/principalService';
import {
  taskLabel,
  taskTime,
  taskDueDate,
  taskError,
  visibleTaskActions,
  taskStyles as styles,
} from './taskUi';

type Props = NativeStackScreenProps<PrincipalStackParamList, 'TaskDetail'>;
const actionTitles: Record<TaskAction, string> = {
  start: 'Start task',
  complete: 'Complete task',
  cancel: 'Cancel task',
};

export default function PrincipalTaskDetailScreen({
  route,
  navigation,
}: Props) {
  const { accessToken } = useAuth();
  const [task, setTask] = useState<PrincipalTask | null>(null);
  const [loading, setLoading] = useState(true);
  const [verified, setVerified] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [success, setSuccess] = useState(route.params.createdMessage || '');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const generation = useRef(0);
  const cancelLoads = useCallback(() => {
    ++generation.current;
  }, []);
  const load = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true);
    setVerified(false);
    setLoadError(null);
    try {
      if (!accessToken)
        throw new Error('Your session is unavailable. Sign in again.');
      const result = await principalService.getTask(
        accessToken,
        route.params.taskId,
      );
      if (current !== generation.current) return;
      setTask(result.data);
      setVerified(true);
    } catch (error) {
      if (current === generation.current) setLoadError(taskError(error));
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }, [accessToken, route.params.taskId]);
  useFocusEffect(
    useCallback(() => {
      load().catch(() => undefined);
      return cancelLoads;
    }, [load, cancelLoads]),
  );

  const submit = async (action: TaskAction) => {
    if (
      !accessToken ||
      !task ||
      !verified ||
      lock.current ||
      !visibleTaskActions(task).includes(action)
    )
      return;
    lock.current = true;
    ++generation.current;
    setBusy(true);
    setActionError(null);
    setSuccess('');
    try {
      const result = await principalService.processTask(
        accessToken,
        task._id,
        action,
      );
      setTask(result.data);
      setVerified(true);
      setSuccess(result.message);
    } catch (error) {
      setActionError(taskError(error));
      await load();
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };

  return (
    <DashboardShell refreshing={loading} onRefresh={busy ? undefined : load}>
      <Button
        title="Back to tasks"
        variant="secondary"
        disabled={busy}
        onPress={() => navigation.goBack()}
      />
      <ScreenHeading title="Task detail" />
      <Button
        title="Refresh task"
        variant="secondary"
        disabled={busy || loading}
        onPress={load}
      />
      {loading ? <Text style={styles.muted}>Loading task...</Text> : null}
      {loadError ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {loadError}
        </Text>
      ) : null}
      {actionError ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {actionError}
        </Text>
      ) : null}
      {success ? (
        <Text accessibilityRole="alert" style={styles.body}>
          {success}
        </Text>
      ) : null}
      {task ? (
        <>
          <SectionCard title={task.title}>
            {task.description ? (
              <Text style={styles.body}>{task.description}</Text>
            ) : null}
            <Text style={styles.body}>
              Assignee: {task.assignee?.fullName || 'Unavailable assignee'}
              {task.assignee ? ` (${taskLabel(task.assignee.role)})` : ''}
            </Text>
            <Text style={styles.body}>
              Creator: {task.creator?.fullName || 'Unavailable creator'}
            </Text>
            <Text style={styles.body}>Status: {taskLabel(task.status)}</Text>
            <Text style={styles.body}>
              Priority: {taskLabel(task.priority)}
            </Text>
            {task.dueDate ? (
              <Text style={styles.body}>Due: {taskDueDate(task.dueDate)}</Text>
            ) : null}
            <Text style={styles.muted}>
              Created: {taskTime(task.createdAt)}
            </Text>
            <Text style={styles.muted}>
              Updated: {taskTime(task.updatedAt)}
            </Text>
          {task.status === 'completed' && task.completedAt ? (
              <Text style={styles.body}>
                Completed: {taskTime(task.completedAt)}
              </Text>
            ) : null}
            {task.assignee?.role === 'teacher' ? (
              <Text style={styles.muted}>
                Teacher self-service for tasks is unavailable. The creating
                Principal can track and update this task.
              </Text>
            ) : null}
          </SectionCard>
          <SectionCard title="Task history">
            {!task.history.length ? (
              <Text style={styles.muted}>No task actions recorded.</Text>
            ) : (
              task.history.map((entry, index) => (
                <Text key={`${entry.createdAt}-${index}`} style={styles.body}>
                  {taskLabel(entry.action)} ·{' '}
                  {entry.performer?.fullName || 'Unavailable user'} ·{' '}
                  {taskTime(entry.createdAt)}
                </Text>
              ))
            )}
          </SectionCard>
          <View style={styles.actions}>
            {verified
              ? visibleTaskActions(task).map(action => (
                  <Button
                    key={action}
                    title={actionTitles[action]}
                    variant={action === 'cancel' ? 'danger' : 'primary'}
                    disabled={busy}
                    onPress={() => submit(action)}
                  />
                ))
              : null}
          </View>
        </>
      ) : null}
    </DashboardShell>
  );
}
