import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { screenOptions } from '../../navigation/screenOptions';
import PasswordScreen from '../../screens/PasswordScreen';
import ParentHome from './ParentHome';
import ParentProfileScreen from './screens/ParentProfileScreen';
import ParentTimetableScreen from './screens/ParentTimetableScreen';
import ParentNoticesScreen from './screens/ParentNoticesScreen';
import ParentAttendanceScreen from './screens/ParentAttendanceScreen';
import ParentAssignmentsScreen from './screens/ParentAssignmentsScreen';
import ParentAssignmentDetailScreen from './screens/ParentAssignmentDetailScreen';
import ParentLecturesScreen from './screens/ParentLecturesScreen';
import ParentLectureDetailScreen from './screens/ParentLectureDetailScreen';
import ParentFeesScreen from './screens/ParentFeesScreen';
import ParentInvoiceDetailScreen from './screens/ParentInvoiceDetailScreen';

const Stack = createNativeStackNavigator();
export default function ParentNavigator() {
  return (
    <Stack.Navigator screenOptions={screenOptions}>
      <Stack.Screen name="Home" component={ParentHome} options={{ title: 'Parent' }} />
      <Stack.Screen name="Profile" component={ParentProfileScreen} options={{ title: 'Parent profile' }} />
      <Stack.Screen name="Timetable" component={ParentTimetableScreen} />
      <Stack.Screen name="Notices" component={ParentNoticesScreen} />
      <Stack.Screen name="Attendance" component={ParentAttendanceScreen} />
      <Stack.Screen name="Assignments" component={ParentAssignmentsScreen} />
      <Stack.Screen name="AssignmentDetail" component={ParentAssignmentDetailScreen} options={{ title: 'Assignment' }} />
      <Stack.Screen name="Lectures" component={ParentLecturesScreen} options={{ title: 'AI learning' }} />
      <Stack.Screen name="LectureDetail" component={ParentLectureDetailScreen} options={{ title: 'Lesson' }} />
      <Stack.Screen name="Fees" component={ParentFeesScreen} options={{ title: 'Fees & receipts' }} />
      <Stack.Screen name="InvoiceDetail" component={ParentInvoiceDetailScreen} options={{ title: 'Invoice & receipts' }} />
      <Stack.Screen name="Password" component={PasswordScreen} />
    </Stack.Navigator>
  );
}
