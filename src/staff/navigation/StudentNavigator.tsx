import React, { useMemo } from 'react';
import {
  createNativeStackNavigator,
  type NativeStackScreenProps,
} from '@react-navigation/native-stack';
import StudentLiveLessonsScreen from '../screens/liveLessons/StudentLiveLessonsScreen';
import LiveLessonRoomScreen from '../screens/liveLessons/LiveLessonRoomScreen';
export type StudentStackParamList = {
  StudentLiveLessons: undefined;
  StudentLiveRoom: { sessionId: string };
};
const Stack = createNativeStackNavigator<StudentStackParamList>();
function StudentLiveRoom({
  route,
}: NativeStackScreenProps<StudentStackParamList, 'StudentLiveRoom'>) {
  const target = useMemo(
    () => ({ kind: 'student' as const, sessionId: route.params.sessionId }),
    [route.params.sessionId],
  );
  return <LiveLessonRoomScreen target={target} />;
}
export default function StudentNavigator() {
  return (
    <Stack.Navigator>
      <Stack.Screen
        name="StudentLiveLessons"
        component={StudentLiveLessonsScreen}
        options={{ title: 'Live lessons' }}
      />
      <Stack.Screen
        name="StudentLiveRoom"
        component={StudentLiveRoom}
        getId={({ params }) => params.sessionId}
        options={{ title: 'Live lesson' }}
      />
    </Stack.Navigator>
  );
}
