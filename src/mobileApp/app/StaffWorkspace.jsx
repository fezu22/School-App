import React, {useCallback, useEffect, useState} from 'react';
import {AppState, Pressable, Text, View} from 'react-native';
import ExamPapersPage from '../features/exams/ExamPapersPage';
import {theme as t} from '../theme/hiraTheme';
import {AuthProvider} from '../../staff/context/AuthContext';
import TeacherNavigator from '../../staff/navigation/TeacherNavigator';
import PrincipalNavigator from '../../staff/navigation/PrincipalNavigator';
import SuperAdminNavigator from '../../staff/navigation/SuperAdminNavigator';
import {getAuthHeaders, checkSessionExpiry, subscribeSessionExpiry} from '../shared/services/authSession';

export default function StaffWorkspace({user, onExit}) {
  const [papersOpen, setPapersOpen] = useState(false);
  const closePapers = useCallback(() => setPapersOpen(false), []);
  useEffect(() => {
    const unsubscribe = subscribeSessionExpiry(onExit);
    const timer = setInterval(checkSessionExpiry, 15000);
    const listener = AppState.addEventListener('change', state => {
      if (state === 'active') checkSessionExpiry();
    });
    return () => {unsubscribe(); clearInterval(timer); listener.remove();};
  }, [onExit]);
  const token = getAuthHeaders().Authorization?.replace(/^Bearer /, '') || null;
  const Navigator = user.role === 'teacher' ? TeacherNavigator
    : user.role === 'principal' ? PrincipalNavigator : SuperAdminNavigator;
  return <AuthProvider key={user.id} initialUser={user} initialAccessToken={token} onSignedOut={onExit}>
    {papersOpen ? <ExamPapersPage user={user} onBack={closePapers} /> : <View style={{flex: 1}}>
      <Pressable accessibilityRole="button" onPress={() => setPapersOpen(true)} style={{padding: 14, backgroundColor: t.lavender}}>
        <Text style={{color: t.primary, fontWeight: '700'}}>Exam papers & print templates</Text>
      </Pressable>
      <Navigator />
    </View>}
  </AuthProvider>;
}
