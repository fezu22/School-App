import React from 'react';
import { Text } from 'react-native';
import { useAuth } from '../auth/AuthContext';
import { MODULES } from '../navigation/modules';
import { Card, Empty, Muted, Page, Title } from '../components/UI';
import { colors } from '../theme';

const descriptions = {
  Profile: 'Review your account and sign-in details.',
  Lectures: 'Review published lessons or prepare transcript-based learning.',
  Assignments: 'See homework, submissions, feedback and grading.',
  Attendance: 'View or record attendance for permitted classes.',
  Classes: 'Browse only classes available to your account.',
  Students: 'View permitted student records and linked children.',
  Timetable: 'See the schedule for assigned classes.',
  Notices: 'Read school and class notices.',
  Invoices: 'Review invoices, balances and receipts.',
  Users: 'Manage accounts and verified access assignments.',
  Branches: 'Set up school campuses.',
  Audit: 'Review administrative activity.',
  Settings: 'Manage school identity.',
  Password: 'Update your sign-in password.',
};

export default function ModuleHubScreen({ route, navigation }) {
  const { user } = useAuth();
  const group = route.name;
  const modules = MODULES.filter(
    item => item.group === group && item.roles.includes(user.role),
  );
  return (
    <Page>
      <Muted>{user.role.replaceAll('_', ' ')}</Muted>
      <Title>{group === 'More' ? 'More tools' : group}</Title>
      <Muted>Available features are based on your assigned role.</Muted>
      {!modules.length && (
        <Empty text="No additional modules are enabled for this account." />
      )}
      {modules.map(module => (
        <Card
          key={module.screen}
          onPress={() => navigation.navigate(module.screen)}
        >
          <Text
            style={{
              color: colors.text,
              fontSize: 17,
              fontWeight: '700',
              marginBottom: 6,
            }}
          >
            {module.title}
          </Text>
          <Muted>{descriptions[module.screen]}</Muted>
        </Card>
      ))}
    </Page>
  );
}
