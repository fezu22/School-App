import React, { useCallback, useState } from 'react';
import { Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../auth/AuthContext';
import { useParentChild } from '../auth/ParentChildContext';
import { api } from '../api/client';
import {
  Page,
  Card,
  Title,
  Muted,
  Button,
  ErrorText,
  Empty,
  Choice,
} from '../components/UI';
import { colors } from '../theme';

function money(paisa = 0) {
  return `PKR ${(paisa / 100).toLocaleString(undefined, {
    maximumFractionDigits: 2,
  })}`;
}

export default function HomeScreen({ navigation }) {
  const { user, schoolName, signOut } = useAuth();
  const {
    children,
    selectedChild,
    selectedChildId,
    selectChild,
    loadingChildren,
    childrenError,
  } = useParentChild();
  const [snapshot, setSnapshot] = useState({});
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (user.role === 'PARENT' && !selectedChildId) {
      setSnapshot({});
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    const requests = [
      ['dashboard', '/dashboard'],
      ...(['TEACHER', 'PRINCIPAL', 'STUDENT', 'PARENT'].includes(user.role)
        ? [['timetable', '/timetable']]
        : []),
      ...(['TEACHER', 'PRINCIPAL', 'STUDENT', 'PARENT', 'SUPER_ADMIN'].includes(
        user.role,
      )
        ? [['assignments', '/assignments']]
        : []),
      ...([
        'ACCOUNTANT',
        'PRINCIPAL',
        'STUDENT',
        'PARENT',
        'SUPER_ADMIN',
      ].includes(user.role)
        ? [['invoices', '/invoices']]
        : []),
      ...(['STUDENT', 'PARENT'].includes(user.role)
        ? [['attendance', '/attendance']]
        : []),
      ...(user.role === 'TEACHER'
        ? [['reviews', '/assignments/reviews/summary']]
        : []),
    ];
    const results = await Promise.all(
      requests.map(async ([key, path]) => {
        try {
          return [key, await api(path)];
        } catch (e) {
          if (!['STALE_CHILD_SELECTION', 'NO_CHILD_SELECTED'].includes(e.code))
            setError(e.message);
          return [key, null];
        }
      }),
    );
    setSnapshot(Object.fromEntries(results.filter(([, value]) => value)));
    setLoading(false);
  }, [user.role, selectedChildId]);

  useFocusEffect(
    useCallback(() => {
      let mounted = true;
      load().catch(e => mounted && setError(e.message));
      return () => {
        mounted = false;
      };
    }, [load]),
  );

  const timetable = snapshot.timetable?.items || [];
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long' });
  const todayPeriods = timetable.filter(item => item.day === today);
  const invoices = snapshot.invoices?.items || [];
  const outstanding = invoices.reduce(
    (sum, item) => sum + Math.max(0, item.balance || 0),
    0,
  );
  const assignments = snapshot.assignments?.items || [];

  return (
    <Page>
      <Muted>
        {schoolName} · {user.role.replaceAll('_', ' ')}
      </Muted>
      <Title>Hello, {user.name}</Title>
      <Muted>
        Your workspace shows live information available to this account.
      </Muted>
      <ErrorText message={error} />
      {user.role === 'PARENT' && (
        <Card>
          <Title>Selected child</Title>
          {loadingChildren ? (
            <Muted>Loading linked children…</Muted>
          ) : children.length ? (
            <Choice
              label="View records for"
              value={selectedChildId}
              options={children.map(child => ({
                value: child._id,
                label: `${child.name} · ${child.classId?.name || 'Class'} ${
                  child.classId?.section || ''
                }`,
              }))}
              onChange={selectChild}
            />
          ) : (
            <Empty
              text={
                childrenError ||
                'No linked children are currently available. Contact the school administrator.'
              }
            />
          )}
          {selectedChild && (
            <Muted>
              Attendance, homework, invoices and lessons below are scoped to{' '}
              {selectedChild.name}.
            </Muted>
          )}
        </Card>
      )}
      {snapshot.dashboard && (
        <View style={{ flexDirection: 'row', gap: 12, marginTop: 12 }}>
          <View style={{ flex: 1 }}>
            <Card>
              <Title>{snapshot.dashboard.classes}</Title>
              <Muted>
                {user.role === 'STUDENT' || user.role === 'PARENT'
                  ? 'Enrolled classes'
                  : 'Permitted classes'}
              </Muted>
            </Card>
          </View>
          <View style={{ flex: 1 }}>
            <Card>
              <Title>{snapshot.dashboard.students}</Title>
              <Muted>
                {user.role === 'STUDENT' || user.role === 'PARENT'
                  ? 'Linked students'
                  : 'Permitted students'}
              </Muted>
            </Card>
          </View>
        </View>
      )}
      {['TEACHER', 'PRINCIPAL', 'STUDENT', 'PARENT'].includes(user.role) && (
        <Card>
          <Title>Today’s timetable</Title>
          {todayPeriods.length ? (
            todayPeriods.map(period => (
              <View
                key={period._id}
                style={{
                  borderTopWidth: 1,
                  borderTopColor: colors.border,
                  paddingTop: 10,
                  marginTop: 8,
                }}
              >
                <Text
                  style={{
                    color: colors.text,
                    fontWeight: '700',
                    fontSize: 16,
                  }}
                >
                  {period.start}–{period.end} · {period.subject}
                </Text>
                <Muted>
                  {period.classId?.name} {period.classId?.section} ·{' '}
                  {period.room}
                </Muted>
              </View>
            ))
          ) : (
            <Empty
              text={
                loading
                  ? 'Loading your schedule…'
                  : 'No periods are scheduled for today.'
              }
            />
          )}
        </Card>
      )}
      {['STUDENT', 'PARENT'].includes(user.role) && (
        <Card>
          <Title>Learning overview</Title>
          <Muted>
            {assignments.filter(item => item.published).length} published
            assignments available
          </Muted>
          <Muted>
            {snapshot.attendance?.items?.length || 0} attendance records
            available
          </Muted>
        </Card>
      )}
      {user.role === 'TEACHER' && (
        <Card>
          <Title>Teaching workload</Title>
          <Muted>
            {user.classIds?.length || 0} assigned classes · {assignments.length}{' '}
            assignments
          </Muted>
          <Muted>
            {snapshot.reviews?.pendingSubmissions ?? 0} submissions awaiting a
            final teacher review
          </Muted>
        </Card>
      )}
      {user.role === 'ACCOUNTANT' && (
        <Card>
          <Title>Fee overview</Title>
          <Text
            style={{ color: colors.primary, fontWeight: '800', fontSize: 24 }}
          >
            {money(outstanding)}
          </Text>
          <Muted>{invoices.length} invoices in your assigned branch</Muted>
        </Card>
      )}
      {user.role === 'PRINCIPAL' && (
        <Card>
          <Title>Branch overview</Title>
          <Muted>
            {todayPeriods.length} scheduled periods today · {assignments.length}{' '}
            assignments in permitted classes
          </Muted>
        </Card>
      )}
      {['STUDENT', 'PARENT'].includes(user.role) && (
        <Card>
          <Title>Upcoming homework</Title>
          {assignments
            .filter(
              item =>
                item.published &&
                item.dueDate >= new Date().toISOString().slice(0, 10),
            )
            .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
            .slice(0, 3)
            .map(item => (
              <View
                key={item._id}
                style={{
                  borderTopWidth: 1,
                  borderTopColor: colors.border,
                  paddingTop: 9,
                  marginTop: 9,
                }}
              >
                <Text
                  style={{
                    color: colors.text,
                    fontSize: 15,
                    fontWeight: '700',
                  }}
                >
                  {item.title}
                </Text>
                <Muted>
                  {item.subject} · Due {item.dueDate}
                </Muted>
              </View>
            ))}
          {!assignments.some(
            item =>
              item.published &&
              item.dueDate >= new Date().toISOString().slice(0, 10),
          ) && (
            <Muted>
              No upcoming assignments in the selected child’s accessible
              classes.
            </Muted>
          )}
        </Card>
      )}
      {user.role === 'PARENT' && selectedChild && (
        <Card>
          <Title>Family services</Title>
          <Muted>
            Live location is unavailable because no GPS/tracking integration is
            connected.
          </Muted>
        </Card>
      )}
      {user.role === 'SUPER_ADMIN' && (
        <Card>
          <Title>School administration</Title>
          <Muted>
            Manage campuses, access assignments and audit records from More.
          </Muted>
        </Card>
      )}
      {loading && <Muted>Refreshing school data…</Muted>}
      <Button title="Refresh" secondary onPress={load} busy={loading} />
      <Button title="Sign out" onPress={signOut} secondary />
    </Page>
  );
}
