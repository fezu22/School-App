import LecturesScreen from '../screens/LecturesScreen';
import LectureDetailScreen from '../screens/LectureDetailScreen';
import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAuth } from '../auth/AuthContext';
import { Busy } from '../components/UI';
import LoginScreen from '../screens/LoginScreen';
import PasswordScreen from '../screens/PasswordScreen';
import HomeScreen from '../screens/HomeScreen';
import RecordsScreen from '../screens/RecordsScreen';
import AttendanceScreen from '../screens/AttendanceScreen';
import AssignmentsScreen from '../screens/AssignmentsScreen';
import AssignmentDetailScreen from '../screens/AssignmentDetailScreen';
import InvoiceDetailScreen from '../screens/InvoiceDetailScreen';
import SettingsScreen from '../screens/SettingsScreen';
const Stack = createNativeStackNavigator();
export default function RootNavigator() {
  const { user, loading } = useAuth();
  if (loading) return <Busy />;
  return (
    <NavigationContainer>
      <Stack.Navigator
        screenOptions={{
          headerShadowVisible: false,
          headerTintColor: '#162A43',
          contentStyle: { backgroundColor: '#F3F6FB' },
        }}
      >
        {!user ? (
          <Stack.Screen
            name="Login"
            component={LoginScreen}
            options={{ headerShown: false }}
          />
        ) : user.mustChangePassword ? (
          <Stack.Screen
            name="Password"
            component={PasswordScreen}
            options={{ headerBackVisible: false }}
          />
        ) : (
          <>
            <Stack.Screen
              name="Home"
              component={HomeScreen}
              options={{ title: 'Workspace' }}
            />
            {[
              'Users',
              'Branches',
              'Classes',
              'Students',
              'Notices',
              'Timetable',
              'Invoices',
              'Audit',
            ].map(name => (
              <Stack.Screen key={name} name={name} component={RecordsScreen} />
            ))}
            <Stack.Screen
              name="Lectures"
              component={LecturesScreen}
              options={{ title: 'AI learning' }}
            />
            <Stack.Screen
              name="LectureDetail"
              component={LectureDetailScreen}
              options={{ title: 'Lesson' }}
            />
            <Stack.Screen name="Attendance" component={AttendanceScreen} />
            <Stack.Screen name="Assignments" component={AssignmentsScreen} />
            <Stack.Screen
              name="AssignmentDetail"
              component={AssignmentDetailScreen}
              options={{ title: 'Assignment' }}
            />
            <Stack.Screen
              name="InvoiceDetail"
              component={InvoiceDetailScreen}
              options={{ title: 'Invoice & receipts' }}
            />
            <Stack.Screen name="Settings" component={SettingsScreen} />
            <Stack.Screen name="Password" component={PasswordScreen} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
