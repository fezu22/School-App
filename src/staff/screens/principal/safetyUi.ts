import { StyleSheet } from 'react-native';
import { ApiError } from '../../services/api/apiClient';
import {
  SafetyAlert,
  SafetyAction,
} from '../../services/principal/principalService';
import { colors, typography } from '../../theme/hiraDashboard';

export const safetyTypes = [
  'missing_attendance',
  'substitute_gap',
  'bus_exception',
  'gate_exception',
  'incident',
  'helpdesk',
  'backup_failure',
] as const;
export const safetyStatuses = ['open', 'in_progress', 'resolved'] as const;
export const safetySeverities = ['low', 'medium', 'high', 'critical'] as const;
export const safetyLabel = (value: string) =>
  value.replaceAll('_', ' ').replace(/^./, first => first.toUpperCase());
export const safetyTime = (value: string) => new Date(value).toLocaleString();
export function safetyError(error: unknown, actionAttempt = false) {
  const message =
    error instanceof Error ? error.message : 'Request could not be confirmed.';
  if (!(error instanceof ApiError))
    return `${message} ${
      actionAttempt
        ? 'The action may have reached the server. Refresh before retrying.'
        : 'Check your connection and retry.'
    }`;
  const advice: Record<number, string> = {
    400: 'Check the selection and filters.',
    401: 'Sign in again.',
    403: 'Your permission or officer eligibility may have changed.',
    404: 'The alert or officer is unavailable in your branch.',
    409: 'The alert changed. Review the refreshed state.',
  };
  return `${message} (${error.status}) ${
    error.status >= 500 && actionAttempt
      ? 'The action may have reached the server. Refresh before retrying.'
      : advice[error.status] || ''
  }`.trim();
}
export function safetyActions(alert: SafetyAlert): SafetyAction[] {
  if (!['open', 'in_progress'].includes(alert.status)) return [];
  return (alert.capabilities?.allowedActions || []).filter(
    action =>
      action !== 'escalate' ||
      alert.status !== 'in_progress' ||
      alert.severity !== 'critical',
  );
}
export const safetyStyles = StyleSheet.create({
  actions: { gap: 10, marginVertical: 12 },
  filters: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginVertical: 10,
  },
  body: { ...typography.body, color: colors.ink, marginVertical: 6 },
  muted: { ...typography.small, color: colors.muted, marginVertical: 6 },
  error: { ...typography.small, color: colors.danger.text, marginVertical: 10 },
});
