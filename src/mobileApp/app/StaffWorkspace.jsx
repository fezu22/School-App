import React, {useCallback, useEffect, useState} from 'react';
import {AppState, Pressable, ScrollView, Text, View} from 'react-native';
import ExamPapersPage from '../features/exams/ExamPapersPage';
import TeachersDlpPage from '../TeachersDlpPage';
import RecordedLessonsPage from '../RecordedLessonsPage';
import TeacherApplicationsPage from '../TeacherApplicationsPage';
import {theme as t} from '../theme/hiraTheme';
import {AuthProvider} from '../../staff/context/AuthContext';
import TeacherNavigator from '../../staff/navigation/TeacherNavigator';
import PrincipalNavigator from '../../staff/navigation/PrincipalNavigator';
import SuperAdminNavigator from '../../staff/navigation/SuperAdminNavigator';
import {getAuthHeaders, checkSessionExpiry, subscribeSessionExpiry} from '../shared/services/authSession';

const roleLabels = {
  teacher: 'Teacher',
  principal: 'Principal',
  super_admin: 'Super Admin',
};

export default function StaffWorkspace({user, onExit}) {
  const [activeTool, setActiveTool] = useState('');
  const closeTool = useCallback(() => setActiveTool(''), []);
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
  const roleLabel = roleLabels[user.role] || 'Teacher';

  return (
    <AuthProvider key={user.id} initialUser={user} initialAccessToken={token} onSignedOut={onExit}>
      {activeTool === 'papers' ? (
        <ExamPapersPage user={user} onBack={closeTool} />
      ) : activeTool ? (
        <View style={{flex: 1, backgroundColor: t.background}}>
          <Pressable
            accessibilityRole="button"
            onPress={closeTool}
            style={{padding: 14, backgroundColor: t.paper, borderBottomWidth: 1, borderColor: t.border}}
          >
            <Text style={{color: t.primary, fontWeight: '700'}}>← Back to {roleLabel} Workspace</Text>
          </Pressable>
          {activeTool === 'dlp' ? (
            <TeachersDlpPage role={roleLabel} />
          ) : activeTool === 'recorded' ? (
            <RecordedLessonsPage role={roleLabel} />
          ) : (
            <TeacherApplicationsPage />
          )}
        </View>
      ) : (
        <View style={{flex: 1}}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{maxHeight: 52, backgroundColor: t.lavender}}
            contentContainerStyle={{paddingHorizontal: 12, alignItems: 'center', gap: 10}}
          >
            <Pressable accessibilityRole="button" onPress={() => setActiveTool('papers')} style={{paddingVertical: 10, paddingHorizontal: 12}}>
              <Text style={{color: t.primary, fontWeight: '700', fontSize: 13}}>Exam papers & print templates</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={() => setActiveTool('dlp')} style={{paddingVertical: 10, paddingHorizontal: 12}}>
              <Text style={{color: t.primary, fontWeight: '700', fontSize: 13}}>Teachers DLP & Work Completion</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={() => setActiveTool('recorded')} style={{paddingVertical: 10, paddingHorizontal: 12}}>
              <Text style={{color: t.primary, fontWeight: '700', fontSize: 13}}>Recorded Lessons & AI Drafts</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={() => setActiveTool('applications')} style={{paddingVertical: 10, paddingHorizontal: 12}}>
              <Text style={{color: t.primary, fontWeight: '700', fontSize: 13}}>Applications & Principal Routing</Text>
            </Pressable>
          </ScrollView>
          <Navigator />
        </View>
      )}
    </AuthProvider>
  );
}
