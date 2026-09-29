import React, { useCallback, useState } from 'react';
import { View, Text } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../auth/AuthContext';
import { api } from '../api/client';
import { Page, Card, Title, Muted, Button, ErrorText } from './UI';

// modules: [title, screenName, allowedRoles?]  (allowedRoles optional)
export default function RoleHome({
  navigation,
  modules,
  subtitle = 'Only your assigned school work appears here.',
  statLabels = ['Accessible classes', 'Linked students'],
}) {
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
      <Muted>{subtitle}</Muted>
      <ErrorText message={error} />
      {stats && (
        <View style={{ flexDirection: 'row', gap: 12, marginTop: 20 }}>
          <View style={{ flex: 1 }}>
            <Card>
              <Title>{stats.classes}</Title>
              <Muted>{statLabels[0]}</Muted>
            </Card>
          </View>
          <View style={{ flex: 1 }}>
            <Card>
              <Title>{stats.students}</Title>
              <Muted>{statLabels[1]}</Muted>
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
