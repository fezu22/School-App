import React from 'react';
import { Text } from 'react-native';
import { Button, SectionCard } from '../../components/hiraDashboard';
import { formStyles } from '../../components/hiraDashboard/AdminForm';
import { useAuth } from '../../context/AuthContext';
import { hasPermission, PERMISSIONS } from '../../constants/permissions';
export function TeacherAssignmentEntry({ onAssign }: { onAssign: () => void }) {
  const { user } = useAuth();
  if (
    !['principal', 'super_admin'].includes(user?.role ?? '') ||
    !hasPermission(user?.role, PERMISSIONS.TEACHER_ASSIGNMENTS_MANAGE)
  )
    return null;
  return (
    <SectionCard title="Teacher Academic Management">
      <Text style={formStyles.copy}>
        Assign class, section and subject scope. Teacher accounts and academic
        authority are managed separately.
      </Text>
      <Button
        title="Assign Teacher"
        variant="secondary"
        onPress={onAssign}
        style={formStyles.action}
      />
    </SectionCard>
  );
}
