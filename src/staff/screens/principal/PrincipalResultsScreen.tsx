import React, { useCallback, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { PrincipalStackParamList } from '../../navigation/PrincipalNavigator';
import {
  Button,
  DashboardShell,
  ScreenHeading,
  SectionCard,
  StatusBadge,
} from '../../components/hiraDashboard';
import {
  AdminFeedback,
  formStyles,
} from '../../components/hiraDashboard/AdminForm';
import { useAuth } from '../../context/AuthContext';
import { ApiError } from '../../services/api/apiClient';
import {
  resultModerationService,
  type ResultQueueState,
} from '../../services/principal/resultModerationService';
import { useTeacherResource } from '../teacher/useTeacherResource';
import { styles } from '../teacher/teacherUi';

const groups: { state: ResultQueueState; title: string; empty: string }[] = [
  {
    state: 'pending',
    title: 'Pending Review',
    empty: 'No results are waiting for moderation.',
  },
  {
    state: 'awaiting_publication',
    title: 'Awaiting Publication',
    empty: 'No approved results are awaiting publication.',
  },
  {
    state: 'published',
    title: 'Published',
    empty: 'No results have been published.',
  },
  {
    state: 'returned',
    title: 'Changes Requested',
    empty: 'No results are awaiting Teacher changes.',
  },
  {
    state: 'rejected',
    title: 'Rejected',
    empty: 'No results have been rejected.',
  },
];
export default function PrincipalResultsScreen(
  props: NativeStackScreenProps<PrincipalStackParamList, 'Results'>,
) {
  const { accessToken, user } = useAuth();
  return (
    <ResultsQueue
      key={JSON.stringify([accessToken, user])}
      token={accessToken}
      onOpen={id =>
        props.navigation.navigate('ResultModeration', { approvalId: id })
      }
    />
  );
}
function ResultsQueue({
  token,
  onOpen,
}: {
  token: string | null;
  onOpen: (id: string) => void;
}) {
  const [state, setState] = useState<ResultQueueState>('awaiting_publication'),
    [offset, setOffset] = useState(0);
  const [searchInput, setSearchInput] = useState(''),
    [search, setSearch] = useState('');
  const load = useCallback(async () => {
    if (!token)
      throw new Error('Your session is unavailable. Please sign in again.');
    try {
      return await resultModerationService.list(token, {
        state,
        search,
        offset,
      });
    } catch (error) {
      if (error instanceof ApiError && [401, 403].includes(error.status))
        throw new Error(
          'You do not have permission to view results in an active Branch.',
        );
      throw new Error('Unable to load results. Please retry.');
    }
  }, [token, state, search, offset]);
  const resource = useTeacherResource(load),
    page = resource.data,
    group = groups.find(item => item.state === state)!;
  return (
    <DashboardShell
      refreshing={resource.loading}
      onRefresh={resource.refresh}
      keyboardShouldPersistTaps="handled"
    >
      <ScreenHeading
        title="Results"
        subtitle="Review submissions, reopen approved results and manage explicit publication."
      />
      <SectionCard title="Result Queues">
        <View style={formStyles.field}>
          {groups.map(item => (
            <Button
              key={item.state}
              title={item.title}
              variant={state === item.state ? 'primary' : 'secondary'}
              onPress={() => {
                setState(item.state);
                setOffset(0);
              }}
            />
          ))}
        </View>
      </SectionCard>
      <SectionCard title="Find a Result">
        <TextInput
          accessibilityLabel="Search results"
          placeholder="Assessment, class, subject, Teacher, Student or year"
          value={searchInput}
          onChangeText={setSearchInput}
          maxLength={80}
          style={formStyles.input}
          onSubmitEditing={() => {
            setSearch(searchInput.trim());
            setOffset(0);
          }}
        />
        <Button
          title="Search"
          variant="secondary"
          onPress={() => {
            setSearch(searchInput.trim());
            setOffset(0);
          }}
        />
      </SectionCard>
      {resource.loading ? (
        <Text style={styles.body}>Loading results...</Text>
      ) : resource.error ? (
        <>
          <AdminFeedback
            kind="error"
            title="Unable to Load Results"
            message={resource.error}
          />
          <Button
            title="Retry"
            variant="secondary"
            onPress={resource.refresh}
          />
        </>
      ) : page ? (
        <>
          {page.configurationIssueCount > 0 ? (
            <AdminFeedback
              kind="error"
              title="Academic Configuration"
              message="Some results have invalid or inactive academic references. Ask an administrator to review the academic setup."
            />
          ) : null}
          <SectionCard title={group.title}>
            <Text style={styles.muted}>
              {page.total} result{page.total === 1 ? '' : 's'}
            </Text>
            {page.items.length === 0 ? (
              <Text style={styles.body}>
                {search ? 'No results match this search.' : group.empty}
              </Text>
            ) : (
              page.items.map(item => (
                <SectionCard key={item.resultId} title={item.assessmentTitle}>
                  {item.studentName ? (
                    <Text style={styles.body}>{item.studentName}</Text>
                  ) : null}
                  <StatusBadge
                    status={
                      item.status === 'published'
                        ? 'paid'
                        : item.status === 'rejected'
                        ? 'unpaid'
                        : 'pending'
                    }
                    label={
                      item.status === 'published'
                        ? 'Published'
                        : item.status === 'moderated_approved'
                        ? 'Approved'
                        : item.status === 'returned_for_revision'
                        ? 'Returned'
                        : item.status === 'rejected'
                        ? 'Rejected'
                        : 'In review'
                    }
                  />
                  <Text style={styles.body}>
                    {item.className} / {item.sectionName} · {item.subjectName}
                  </Text>
                  <Text style={styles.muted}>
                    {item.teacherName || 'Teacher unavailable'} ·{' '}
                    {item.academicYear}
                  </Text>
                  <Text style={styles.muted}>
                    {item.status === 'moderated_approved'
                      ? 'Approved · Unpublished'
                      : item.status.replaceAll('_', ' ')}
                  </Text>
                  <Button
                    title="Review Result"
                    variant="secondary"
                    onPress={() => onOpen(item.approvalId)}
                  />
                </SectionCard>
              ))
            )}
          </SectionCard>
          <View style={formStyles.field}>
            {offset > 0 ? (
              <Button
                title="Previous Page"
                variant="secondary"
                onPress={() => setOffset(Math.max(0, offset - 20))}
              />
            ) : null}
            {page.nextOffset !== null ? (
              <Button
                title="Next Page"
                variant="secondary"
                onPress={() => setOffset(page.nextOffset!)}
              />
            ) : null}
          </View>
        </>
      ) : null}
    </DashboardShell>
  );
}
