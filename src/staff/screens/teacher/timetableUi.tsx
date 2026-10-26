import React from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Button, Card, StatusBadge } from '../../components/hiraDashboard';
import { colors, radius, spacing, typography } from '../../theme/hiraDashboard';
import type { TeacherPeriod } from '../../services/teacher/timetableService';

export function TimetableState({
  loading,
  error,
  retry,
}: {
  loading: boolean;
  error: string | null;
  retry: () => Promise<void>;
}) {
  if (!loading && !error) return null;
  return (
    <Card>
      {loading ? (
        <>
          <ActivityIndicator color={colors.primary} />
          <Text style={timetableStyles.body}>Loading timetable...</Text>
        </>
      ) : (
        <>
          <Text accessibilityRole="alert" style={timetableStyles.body}>
            {error}
          </Text>
          <Button
            title="Retry"
            onPress={() => {
              retry();
            }}
          />
        </>
      )}
    </Card>
  );
}
export function PeriodSummary({ period }: { period: TeacherPeriod }) {
  return (
    <View style={timetableStyles.group}>
      <Text style={timetableStyles.heading}>
        {period.date} / {period.startTime} - {period.endTime}
      </Text>
      <Text style={timetableStyles.body}>
        {period.className} / {period.sectionName} / {period.subjectName}
      </Text>
      <Text style={timetableStyles.body}>Room: {period.room}</Text>
      <Text style={timetableStyles.muted}>
        Approved version {period.approvedVersion.versionNumber}
      </Text>
      <Text style={timetableStyles.muted}>
        Effective {period.approvedVersion.effectiveFrom} until{' '}
        {period.approvedVersion.effectiveUntil} (exclusive)
      </Text>
      {period.isSubstitute ? (
        <StatusBadge
          status={
            period.substituteStatus === 'acknowledged' ? 'paid' : 'pending'
          }
          label={
            period.substituteStatus === 'acknowledged'
              ? 'Acknowledged'
              : 'Needs ack'
          }
        />
      ) : null}
      {period.isSubstitute ? (
        <Text style={timetableStyles.body}>
          Approved substitute / replacement active
        </Text>
      ) : null}
      {period.acknowledgedAt ? (
        <Text style={timetableStyles.muted}>
          Acknowledged: {period.acknowledgedAt}
        </Text>
      ) : null}
      {period.issueStatus ? (
        <StatusBadge status="pending" label="Issue open" />
      ) : null}
    </View>
  );
}
export function DateInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <TextInput
      accessibilityLabel="Timetable date"
      placeholder="YYYY-MM-DD"
      value={value}
      onChangeText={onChange}
      style={timetableStyles.input}
      autoCapitalize="none"
    />
  );
}
export const validTimetableDate = (value: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value + 'T12:00:00Z').toISOString().slice(0, 10) === value;
export const timetableStyles = StyleSheet.create({
  heading: { ...typography.h3, color: colors.ink },
  body: { ...typography.body, color: colors.ink },
  muted: { ...typography.small, color: colors.muted },
  group: { gap: spacing.sm },
  input: {
    ...typography.body,
    color: colors.ink,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    minHeight: 48,
  },
  selected: { borderColor: colors.primary },
  actions: { gap: spacing.sm, marginTop: spacing.md },
});
