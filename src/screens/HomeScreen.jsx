import React, { useCallback, useState } from 'react';
import { View, Text } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../auth/AuthContext';
import { api } from '../api/client';
import { Page, Card, Title, Muted, Button, ErrorText } from '../components/UI';
const modules = [
  [
    'AI learning',
    'Lectures',
    ['SUPER_ADMIN', 'PRINCIPAL', 'TEACHER', 'STUDENT', 'PARENT'],
  ],
  ['Users', 'Users', ['SUPER_ADMIN']],
  ['Branches', 'Branches', ['SUPER_ADMIN']],
  [
    'Classes',
    'Classes',
    [
      'SUPER_ADMIN',
      'PRINCIPAL',
      'TEACHER',
      'ACADEMIC_COORDINATOR',
      'EXAM_OFFICER',
    ],
  ],
  [
    'Students',
    'Students',
    ['SUPER_ADMIN', 'PRINCIPAL', 'TEACHER', 'ACCOUNTANT', 'PARENT', 'STUDENT'],
  ],
  [
    'Attendance',
    'Attendance',
    ['SUPER_ADMIN', 'PRINCIPAL', 'TEACHER', 'STUDENT', 'PARENT'],
  ],
  [
    'Assignments',
    'Assignments',
    ['SUPER_ADMIN', 'PRINCIPAL', 'TEACHER', 'STUDENT', 'PARENT'],
  ],
  [
    'Timetable',
    'Timetable',
    [
      'SUPER_ADMIN',
      'PRINCIPAL',
      'TEACHER',
      'STUDENT',
      'PARENT',
      'ACADEMIC_COORDINATOR',
    ],
  ],
  ['Notices', 'Notices', null],
  [
    'Fees & receipts',
    'Invoices',
    ['SUPER_ADMIN', 'PRINCIPAL', 'ACCOUNTANT', 'STUDENT', 'PARENT'],
  ],
  ['Audit trail', 'Audit', ['SUPER_ADMIN']],
  ['School settings', 'Settings', ['SUPER_ADMIN']],
];
export default function HomeScreen({ navigation }) {
  const { user, schoolName, signOut } = useAuth();
  const [stats, setStats] = useState(null),
    [error, setError] = useState('');
  useFocusEffect(
    useCallback(() => {
      let mounted = true;
      api('/dashboard')
        .then(d => mounted && setStats(d))
        .catch(e => mounted && setError(e.message));
      return () => {
        mounted = false;
      };
    }, []),
  );
  return (
    <Page>
      <Muted>
        {schoolName} · {user.role.replaceAll('_', ' ')}
      </Muted>
      <Title>Hello, {user.name}</Title>
      <Muted>Only your assigned school work appears here.</Muted>
      <ErrorText message={error} />
      {stats && (
        <View style={{ flexDirection: 'row', gap: 12, marginTop: 20 }}>
          <View style={{ flex: 1 }}>
            <Card>
              <Title>{stats.classes}</Title>
              <Muted>Accessible classes</Muted>
            </Card>
          </View>
          <View style={{ flex: 1 }}>
            <Card>
              <Title>{stats.students}</Title>
              <Muted>Linked students</Muted>
            </Card>
          </View>
        </View>
      )}
      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          marginTop: 10,
        }}
      >
        {modules
          .filter(m => !m[2] || m[2].includes(user.role))
          .map(([title, screen]) => (
            <View key={screen} style={{ width: '48%' }}>
              <Card onPress={() => navigation.navigate(screen)}>
                <Text
                  style={{ fontSize: 17, fontWeight: '700', color: '#162A43' }}
                >
                  {title}
                </Text>
                <Muted>Open →</Muted>
              </Card>
            </View>
          ))}
      </View>
      <Button
        title="Change password"
        onPress={() => navigation.navigate('Password')}
        secondary
      />
      <Button title="Sign out" onPress={signOut} secondary />
    </Page>
  );
}
