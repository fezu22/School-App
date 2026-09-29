import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { screenOptions } from '../../navigation/screenOptions';
import PasswordScreen from '../../screens/PasswordScreen';
import StudentHome from './StudentHome';
import StudentProfileScreen from './screens/StudentProfileScreen';
import StudentTimetableScreen from './screens/StudentTimetableScreen';
import StudentNoticesScreen from './screens/StudentNoticesScreen';
import StudentAttendanceScreen from './screens/StudentAttendanceScreen';
import StudentAssignmentsScreen from './screens/StudentAssignmentsScreen';
import StudentAssignmentDetailScreen from './screens/StudentAssignmentDetailScreen';
import StudentLecturesScreen from './screens/StudentLecturesScreen';
import StudentLectureDetailScreen from './screens/StudentLectureDetailScreen';
import StudentFeesScreen from './screens/StudentFeesScreen';
import StudentInvoiceDetailScreen from './screens/StudentInvoiceDetailScreen';

const Stack = createNativeStackNavigator();
export default function StudentNavigator() {
  return (
    <Stack.Navigator screenOptions={screenOptions}>
      <Stack.Screen name="Home" component={StudentHome} options={{ title: 'Student' }} />
      <Stack.Screen name="Profile" component={StudentProfileScreen} options={{ title: 'Student profile' }} />
      <Stack.Screen name="Timetable" component={StudentTimetableScreen} />
      <Stack.Screen name="Notices" component={StudentNoticesScreen} />
      <Stack.Screen name="Attendance" component={StudentAttendanceScreen} />
      <Stack.Screen name="Assignments" component={StudentAssignmentsScreen} />
      <Stack.Screen name="AssignmentDetail" component={StudentAssignmentDetailScreen} options={{ title: 'Assignment' }} />
      <Stack.Screen name="Lectures" component={StudentLecturesScreen} options={{ title: 'AI learning' }} />
      <Stack.Screen name="LectureDetail" component={StudentLectureDetailScreen} options={{ title: 'Lesson' }} />
      <Stack.Screen name="Fees" component={StudentFeesScreen} options={{ title: 'Fees & receipts' }} />
      <Stack.Screen name="InvoiceDetail" component={StudentInvoiceDetailScreen} options={{ title: 'Invoice & receipts' }} />
      <Stack.Screen name="Password" component={PasswordScreen} />
    </Stack.Navigator>
  );
}
