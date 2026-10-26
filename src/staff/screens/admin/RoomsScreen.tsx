import React from 'react';
import { Text } from 'react-native';
import { useAuth } from '../../context/AuthContext';
import { hasPermission, PERMISSIONS } from '../../constants/permissions';
import AcademicSetupScreen from './AcademicSetupScreen';
export default function RoomsScreen() {
  const { user, accessToken } = useAuth();
  if (
    !accessToken ||
    !hasPermission(user?.role, PERMISSIONS.ACADEMIC_ROOMS_VIEW)
  )
    return <Text>Room management is not permitted.</Text>;
  return <AcademicSetupScreen roomsOnly />;
}
