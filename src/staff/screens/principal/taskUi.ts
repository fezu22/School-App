import { StyleSheet } from 'react-native';
import { ApiError } from '../../services/api/apiClient';
import {
  PrincipalTask,
  TaskAction,
} from '../../services/principal/principalService';
import { colors, typography } from '../../theme/hiraDashboard';

export const taskStatuses = [
  'pending',
  'in_progress',
  'completed',
  'cancelled',
] as const;
export const taskPriorities = ['low', 'normal', 'high', 'urgent'] as const;
export const taskLabel = (value: string) =>
  value.replaceAll('_', ' ').replace(/^./, first => first.toUpperCase());
export const taskTime = (value: string) => new Date(value).toLocaleString();
export const taskDueDate = (value: string) =>
  new Date(value).toLocaleDateString('en-PK', { timeZone: 'UTC' });

export function taskError(error: unknown): string {
  const message =
    error instanceof Error ? error.message : 'Network request failed.';
  if (!(error instanceof ApiError))
    return `${message} Check your connection and refresh before retrying.`;
  const advice: Record<number, string> = {
    400: 'Check the entered task fields.',
    401: 'Sign in again to continue.',
    403: 'Your permission or assignee eligibility may have changed.',
    404: 'The task or assignee is unavailable in your branch.',
    409: 'The task changed. Refresh its current state.',
  };
  return `${message} (${error.status}) ${advice[error.status] || ''}`.trim();
}

export function visibleTaskActions(task: PrincipalTask): TaskAction[] {
  if (!['pending', 'in_progress'].includes(task.status)) return [];
  return (task.capabilities?.allowedActions || []).filter(
    action => action !== 'start' || task.status === 'pending',
  );
}

// Structured calendar fields, never locale-dependent free-form date parsing.
export function taskCalendarDate(
  year: string,
  month: string,
  day: string,
): string | undefined {
  if (!year && !month && !day) return undefined;
  if (
    !/^\d{4}$/.test(year) ||
    !/^\d{1,2}$/.test(month) ||
    !/^\d{1,2}$/.test(day)
  ) {
    throw new Error(
      'Enter a complete due date: four-digit year, month and day.',
    );
  }
  const y = Number(year),
    m = Number(month),
    d = Number(day);
  const calendar = new Date(0);
  calendar.setUTCFullYear(y, m - 1, d);
  if (
    y < 1 ||
    calendar.getUTCFullYear() !== y ||
    calendar.getUTCMonth() !== m - 1 ||
    calendar.getUTCDate() !== d
  ) {
    throw new Error('Enter a valid calendar due date.');
  }
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

export const taskStyles = StyleSheet.create({
  actions: { gap: 10, marginVertical: 12 },
  filters: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginVertical: 10,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 12,
    color: colors.ink,
    marginVertical: 8,
  },
  body: { ...typography.body, color: colors.ink, marginVertical: 6 },
  muted: { ...typography.small, color: colors.muted, marginVertical: 6 },
  error: { ...typography.small, color: colors.danger.text, marginVertical: 10 },
});
