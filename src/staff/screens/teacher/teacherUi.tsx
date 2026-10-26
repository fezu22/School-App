import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { colors, typography } from '../../theme/hiraDashboard';
import type { TeacherAssignment } from '../../services/teacher/teacherService';

export const assignmentLabel = (tuple: TeacherAssignment) =>
  `${tuple.className} / ${tuple.sectionName} / ${tuple.subjectName}`;

export function LoadState({
  loading,
  error,
  retry,
  label = 'Loading assigned classes...',
}: {
  loading: boolean;
  error: string | null;
  retry: () => Promise<void>;
  label?: string;
}) {
  if (loading)
    return (
      <View>
        <ActivityIndicator />
        <Text style={styles.body}>{label}</Text>
      </View>
    );
  if (error)
    return (
      <View accessibilityRole="alert">
        <Text style={styles.body}>{error}</Text>
        <TeacherButton
          title="Retry"
          onPress={() => {
            retry();
          }}
        />
      </View>
    );
  return null;
}
export function TeacherButton({
  title,
  onPress,
}: {
  title: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      style={styles.button}
      onPress={onPress}
    >
      <Text style={styles.buttonText}>{title}</Text>
    </Pressable>
  );
}
export const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: colors.background },
  page: { flex: 1 },
  content: { padding: 20, gap: 16 },
  title: { ...typography.h2, color: colors.ink },
  body: { ...typography.body, color: colors.ink },
  muted: { ...typography.small, color: colors.muted },
  card: {
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    gap: 6,
    marginBottom: 12,
  },
  selected: { borderColor: colors.primary, backgroundColor: colors.soft },
  button: { padding: 14, borderRadius: 12, backgroundColor: colors.primary },
  buttonText: {
    ...typography.bodyStrong,
    color: colors.card,
    textAlign: 'center',
  },
  tabs: { flexDirection: 'row', borderTopWidth: 1, borderColor: colors.border },
  tab: {
    flex: 1,
    minHeight: 56,
    justifyContent: 'center',
    alignItems: 'center',
  },
  search: {
    padding: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    color: colors.ink,
  },
  hidden: { display: 'none' },
});
