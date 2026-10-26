import React, {useCallback} from 'react';
import {Text} from 'react-native';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import type {TeacherStackParamList} from '../../navigation/TeacherNavigator';
import {Button, Card, DashboardShell, ScreenHeading, StatusBadge} from '../../components/hiraDashboard';
import {useAuth} from '../../context/AuthContext';
import {academicReviewService} from '../../services/teacher/academicReviewService';
import {useTeacherResource} from './useTeacherResource';
import {LoadState, styles} from './teacherUi';

export default function TeacherReviewQueueScreen({navigation}: NativeStackScreenProps<TeacherStackParamList, 'TeacherReviewQueue'>) {
  const {accessToken} = useAuth();
  const load = useCallback(() => accessToken ? academicReviewService.queue(accessToken) : Promise.reject(new Error('Authentication required')), [accessToken]);
  const resource = useTeacherResource(load);
  return <DashboardShell refreshing={resource.loading} onRefresh={resource.refresh}>
    <ScreenHeading title="Submissions & Review" subtitle="Learner evidence requiring your academic review" />
    <LoadState {...resource} retry={resource.refresh} label="Loading submission queue..." />
    {resource.data?.items.length === 0 ? <Text style={styles.body}>No submissions currently require review.</Text> : null}
    {resource.data?.items.map((item, index) => <Card key={`${item.targetType}_${item.evidenceId ?? item.workId}_${index}`}>
      <StatusBadge status={item.submissionState === 'missing' ? 'unpaid' : 'pending'} label={item.submissionState.replaceAll('_', ' ')} />
      <Text style={styles.body}>{item.title}</Text>
      <Text style={styles.muted}>{item.student.fullName} • {item.student.admissionNumber}</Text>
      <Text style={styles.muted}>{item.targetType === 'quiz_attempt' ? 'Quiz attempt' : 'Homework'} • {item.timing}</Text>
      <Text style={styles.muted}>Review: {item.reviewState.replaceAll('_', ' ')}</Text>
      {item.evidenceId && item.targetType !== 'missing' ? <Button title={`Review ${item.student.fullName}`} variant="secondary"
        onPress={() => navigation.navigate('TeacherReview', {targetType: item.targetType as 'homework_submission' | 'quiz_attempt', evidenceId: item.evidenceId!})} /> : null}
    </Card>)}
  </DashboardShell>;
}
