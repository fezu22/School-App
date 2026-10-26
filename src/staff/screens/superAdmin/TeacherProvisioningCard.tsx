import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { Button, SectionCard } from '../../components/hiraDashboard';
import { useAuth } from '../../context/AuthContext';
import { hasPermission, PERMISSIONS } from '../../constants/permissions';
import { colors, typography } from '../../theme/hiraDashboard';
export function TeacherProvisioningCard({
  onCreate,
  onAssign,
}: {
  onCreate: () => void;
  onAssign?: () => void;
}) {
  const { user } = useAuth();
  if (
    user?.role !== 'super_admin' ||
    !hasPermission(user.role, PERMISSIONS.TEACHERS_CREATE)
  )
    return null;
  return (
    <SectionCard title="Teacher Management">
      <Text style={styles.copy}>
        Create Teacher accounts and continue to academic assignment.
      </Text>
      <Button title="Create Teacher" onPress={onCreate} />
      {onAssign &&
      hasPermission(user.role, PERMISSIONS.TEACHER_ASSIGNMENTS_MANAGE) ? (
        <Button
          title="Assign Teacher"
          variant="secondary"
          onPress={onAssign}
          style={styles.action}
        />
      ) : null}
    </SectionCard>
  );
}
const styles = StyleSheet.create({
  action: { marginTop: 12 },
  copy: { ...typography.body, color: colors.muted, marginBottom: 12 },
});
