import React from 'react';
import { Alert } from 'react-native';
import { useAuth } from '../auth/AuthContext';
import { Button, Card, Muted, Page, Title } from '../components/UI';
import { colors } from '../theme';

export default function ProfileScreen({ navigation }) {
  const { user, signOut } = useAuth();
  const role = user.role.replaceAll('_', ' ');
  return (
    <Page>
      <Muted>ACCOUNT PROFILE</Muted>
      <Title>{user.name}</Title>
      <Card>
        <Muted>Email address</Muted>
        <Title style={{ color: colors.text }}>{user.email}</Title>
        <Muted>Role · {role}</Muted>
      </Card>
      {user.branchIds?.length > 0 && (
        <Card>
          <Muted>Assigned campuses</Muted>
          <Title>{user.branchIds.length}</Title>
        </Card>
      )}
      {user.classIds?.length > 0 && (
        <Card>
          <Muted>Assigned classes</Muted>
          <Title>{user.classIds.length}</Title>
        </Card>
      )}
      {user.studentIds?.length > 0 && (
        <Card>
          <Muted>Linked student records</Muted>
          <Title>{user.studentIds.length}</Title>
        </Card>
      )}
      <Button
        title="Change password"
        secondary
        onPress={() => navigation.navigate('Password')}
      />
      <Button
        title="Sign out"
        danger
        onPress={() =>
          Alert.alert(
            'Sign out?',
            'You will need to sign in again to view school records.',
            [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Sign out', style: 'destructive', onPress: signOut },
            ],
          )
        }
      />
    </Page>
  );
}
