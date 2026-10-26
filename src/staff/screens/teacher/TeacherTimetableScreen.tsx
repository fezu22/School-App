import React, { useCallback, useState } from 'react';
import { Text } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { TeacherStackParamList } from '../../navigation/TeacherNavigator';
import { useAuth } from '../../context/AuthContext';
import {
  Button,
  Card,
  ScreenHeading,
  SectionCard,
} from '../../components/hiraDashboard';
import { DashboardShell } from '../../components/hiraDashboard/DashboardShell';
import { timetableService } from '../../services/teacher/timetableService';
import { useTeacherResource } from './useTeacherResource';
import { useTimetableAction } from './useTimetableAction';
import {
  DateInput,
  PeriodSummary,
  TimetableState,
  timetableStyles,
  validTimetableDate,
} from './timetableUi';

export default function TeacherTimetableScreen({
  navigation,
}: NativeStackScreenProps<TeacherStackParamList, 'TeacherTimetable'>) {
  const { accessToken } = useAuth();
  const [date, setDate] = useState<string | undefined>(),
    [draftDate, setDraftDate] = useState('');
  const [week, setWeek] = useState(false),
    [selected, setSelected] = useState<string | null>(null),
    [validation, setValidation] = useState<string | null>(null);
  const load = useCallback(() => {
    if (!accessToken)
      return Promise.reject(new Error('Authentication required.'));
    return week
      ? timetableService.getWeek(accessToken, date)
      : timetableService.getToday(accessToken, date);
  }, [accessToken, date, week]);
  const resource = useTeacherResource(
    load,
    'This timetable period is unavailable or you no longer have access.',
  );
  const action = useTimetableAction(
    `${accessToken}/${date}/${week}`,
    resource.refresh,
  );
  return (
    <DashboardShell
      safeArea={false}
      refreshing={resource.loading}
      onRefresh={() => {
        resource.refresh();
      }}
    >
      <ScreenHeading
        title="Timetable"
        subtitle={
          resource.data
            ? `${resource.data.start} to ${resource.data.end} / ${resource.data.timezone}`
            : 'Approved periods and substitute duty'
        }
      />
      <SectionCard title="Select date">
        <DateInput value={draftDate} onChange={setDraftDate} />
        {validation ? (
          <Text accessibilityRole="alert" style={timetableStyles.body}>
            {validation}
          </Text>
        ) : null}
        <Button
          title="Apply date"
          disabled={action.pending}
          onPress={() => {
            if (!validTimetableDate(draftDate.trim())) {
              setValidation('Enter a valid date as YYYY-MM-DD.');
              return;
            }
            setValidation(null);
            setDate(draftDate.trim());
          }}
        />
        <Button
          title="Today"
          disabled={action.pending}
          onPress={() => {
            setDate(undefined);
            setDraftDate('');
            setWeek(false);
            setValidation(null);
          }}
        />
        <Button
          title={week ? 'Show day' : 'Show week'}
          disabled={action.pending}
          onPress={() => setWeek(value => !value)}
        />
      </SectionCard>
      <TimetableState
        loading={resource.loading}
        error={resource.error}
        retry={resource.refresh}
      />
      {action.error ? (
        <Text accessibilityRole="alert" style={timetableStyles.body}>
          {action.error}
        </Text>
      ) : null}
      {action.notice ? (
        <Text style={timetableStyles.body}>{action.notice}</Text>
      ) : null}
      {resource.data?.periods.length === 0 ? (
        <Card>
          <Text style={timetableStyles.body}>
            No effective assigned periods for this date range.
          </Text>
        </Card>
      ) : null}
      {resource.data?.periods.map(period => {
        const key = `${period.periodId}/${period.date}`;
        const open = () => {
          setSelected(key);
          navigation.navigate('TeacherPeriod', {
            periodId: period.periodId,
            date: period.date,
          });
        };
        return (
          <Card
            key={key}
            style={selected === key ? timetableStyles.selected : undefined}
          >
            <PeriodSummary period={period} />
            {selected === key ? (
              <Text style={timetableStyles.muted}>Selected period</Text>
            ) : null}
            <Button
              title="Open period"
              disabled={action.pending}
              onPress={open}
            />
            {period.canAcknowledgeSubstitute ? (
              <Button
                title="Acknowledge substitute"
                disabled={action.pending}
                onPress={() => {
                  action.run(
                    () =>
                      timetableService.acknowledge(
                        accessToken!,
                        period.periodId,
                        period.date,
                      ),
                    'Substitute acknowledgement confirmed.',
                  );
                }}
              />
            ) : null}
            {period.canRequestIssue ? (
              <Button
                title="Request issue"
                disabled={action.pending}
                variant="secondary"
                onPress={open}
              />
            ) : null}
          </Card>
        );
      })}
    </DashboardShell>
  );
}
