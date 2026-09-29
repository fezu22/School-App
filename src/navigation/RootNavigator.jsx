import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAuth } from '../auth/AuthContext';
import { Busy } from '../components/UI';
import { screenOptions } from './screenOptions';
import LoginScreen from '../screens/LoginScreen';
import PasswordScreen from '../screens/PasswordScreen';
import StudentNavigator from '../roles/student/StudentNavigator';
import ParentNavigator from '../roles/parent/ParentNavigator';
import FinanceNavigator from '../roles/finance/FinanceNavigator';
import SuperAdminNavigator from '../roles/superadmin/SuperAdminNavigator';
import PrincipalNavigator from '../roles/principal/PrincipalNavigator';
import TeacherNavigator from '../roles/teacher/TeacherNavigator';
import StaffNavigator from '../roles/staff/StaffNavigator';

const Stack = createNativeStackNavigator();

// Role → dedicated navigator. Remaining roles (HR, LIBRARIAN, ...) fall back to Staff.
const navigators = {
  STUDENT: StudentNavigator,
  PARENT: ParentNavigator,
  ACCOUNTANT: FinanceNavigator,
  SUPER_ADMIN: SuperAdminNavigator,
  PRINCIPAL: PrincipalNavigator,
  TEACHER: TeacherNavigator,
};

export default function RootNavigator() {
  const { user, loading } = useAuth();
  if (loading) return <Busy />;
  const RoleNavigator = user ? navigators[user.role] || StaffNavigator : null;
  return (
    <NavigationContainer>
      {!user ? (
        <Stack.Navigator screenOptions={screenOptions}>
          <Stack.Screen
            name="Login"
            component={LoginScreen}
            options={{ headerShown: false }}
          />
        </Stack.Navigator>
      ) : user.mustChangePassword ? (
        <Stack.Navigator screenOptions={screenOptions}>
          <Stack.Screen
            name="Password"
            component={PasswordScreen}
            options={{ headerBackVisible: false }}
          />
        </Stack.Navigator>
      ) : (
        <RoleNavigator />
      )}
    </NavigationContainer>
  );
}
