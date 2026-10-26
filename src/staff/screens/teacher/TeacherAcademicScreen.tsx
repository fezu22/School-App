import React, { useCallback, useState } from 'react';
import { Text } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { TeacherStackParamList } from '../../navigation/TeacherNavigator';
import { useAuth } from '../../context/AuthContext';
import {
  Button,
  DashboardShell,
  ScreenHeading,
  SectionCard,
  StatusBadge,
} from '../../components/hiraDashboard';
import { formStyles } from '../../components/hiraDashboard/AdminForm';
import { academicService } from '../../services/teacher/academicService';
import { useTeacherResource } from './useTeacherResource';
import { LoadState } from './teacherUi';
import SyllabusCoverage from '../../components/academic/SyllabusCoverage';

export default function TeacherAcademicScreen({
  route,
  navigation,
}: NativeStackScreenProps<TeacherStackParamList, 'TeacherAcademic'>) {
  const { accessToken } = useAuth();
  const { classId, sectionId, subjectId } = route.params;
  const [tab, setTab] = useState<'context' | 'syllabus' | 'lessons'>('context');
  const load = useCallback(async () => {
    if (!accessToken) throw new Error('Authentication required');
    const ids = { classId, sectionId, subjectId };
    const [context, lessons, coverage] = await Promise.all([
      academicService.context(accessToken, ids),
      academicService.lessons(accessToken, ids),
      academicService.coverage(accessToken, ids),
    ]);
    return { context, lessons, coverage };
  }, [accessToken, classId, sectionId, subjectId]);
  const resource = useTeacherResource(load);
  const context = resource.data?.context,
    syllabus = context?.syllabus;
  return (
    <DashboardShell
      safeArea={false}
      onRefresh={resource.refresh}
      refreshing={resource.loading}
    >
      <ScreenHeading
        title={context?.assignment.subjectName ?? 'Class academics'}
        subtitle={
          context
            ? `${context.assignment.className} • Section ${context.assignment.sectionName}\n${context.teacherName} • Academic Year ${context.academicYear}`
            : 'Your assigned academic context'
        }
      />
      <LoadState
        loading={resource.loading}
        error={resource.error}
        retry={resource.refresh}
        label="Loading academic context..."
      />
      {context ? (
        <>
          <SectionCard title="Class workspace">
            <Button
              title="Roster"
              variant="secondary"
              onPress={() => navigation.navigate('TeacherRoster', route.params)}
            />
            <Button
              title="Timetable"
              variant="secondary"
              onPress={() => navigation.navigate('TeacherTimetable')}
            />
            <Button
              title="Syllabus"
              variant="secondary"
              onPress={() => setTab('syllabus')}
            />
            <Button
              title="Lessons"
              variant="secondary"
              onPress={() => setTab('lessons')}
            />
            <Button
              title="Assessments / Marks"
              variant="secondary"
              onPress={() => navigation.navigate('TeacherMarks', route.params)}
            />
          </SectionCard>
          {tab === 'context' ? (
            <SectionCard title="Academic planning">
              <Text style={formStyles.copy}>
                Read the published syllabus and prepare lessons mapped to its
                units and topics.
              </Text>
            </SectionCard>
          ) : null}
          {tab === 'syllabus' ? (
            <>
              <ScreenHeading
                title="Syllabus"
                subtitle={
                  syllabus
                    ? `${syllabus.title} • Version ${syllabus.version}`
                    : undefined
                }
              />
              {syllabus ? (
                <>
                  <StatusBadge status="paid" label="Published" />
                  {resource.data?.coverage ? <SyllabusCoverage coverage={resource.data.coverage} /> : null}
                  {syllabus.units.map(unit => (
                    <SectionCard
                      key={unit.unitId}
                      title={`Unit ${unit.order} — ${unit.title}`}
                    >
                      {unit.topics.map(topic => (
                        <React.Fragment key={topic.topicId}>
                          <Text style={formStyles.label}>
                            {topic.order}. {topic.title}
                          </Text>
                          {topic.outcomes.map((outcome, i) => (
                            <Text key={i} style={formStyles.helper}>
                              {outcome}
                            </Text>
                          ))}
                        </React.Fragment>
                      ))}
                    </SectionCard>
                  ))}
                </>
              ) : (
                <SectionCard title="No published syllabus">
                  <Text style={formStyles.copy}>
                    Academic administration has not published a syllabus for
                    this class, subject and academic year.
                  </Text>
                </SectionCard>
              )}
            </>
          ) : null}
          {tab === 'lessons' ? (
            <>
              <ScreenHeading
                title="Lessons"
                subtitle="Planning, academic review and actual delivery"
              />
              {syllabus ? (
                <Button
                  title="Create Lesson Plan"
                  onPress={() =>
                    navigation.navigate('TeacherLesson', route.params)
                  }
                />
              ) : (
                <Text style={formStyles.copy}>
                  A published syllabus is required before planning.
                </Text>
              )}
              {!resource.data?.lessons.length ? (
                <Text style={formStyles.copy}>
                  No lesson plans in this context.
                </Text>
              ) : null}
              {resource.data?.lessons.map(lesson => (
                <SectionCard
                  key={lesson.lessonPlanId}
                  title={lesson.teachingDate}
                >
                  <StatusBadge
                    status="pending"
                    label={`${
                      lesson.state.replaceAll('_', ' ')
                    } • Revision ${lesson.revision}`}
                  />
                  <Text style={formStyles.copy}>{lesson.objectives}</Text>
                  <Button title="Create Homework" variant="secondary" onPress={() => navigation.navigate('TeacherHomework', {lessonPlanId: lesson.lessonPlanId})} />
                  <Button title="Create Quiz" variant="secondary" onPress={() => navigation.navigate('TeacherQuiz', {lessonPlanId: lesson.lessonPlanId})} />
                  {lesson.state === 'approved' ? <Button title="Record Delivery" onPress={() => navigation.navigate('TeacherDelivery', {lessonPlanId: lesson.lessonPlanId})} /> : null}
                  <Button
                    title={
                      lesson.state === 'draft'
                        ? 'Open draft'
                        : 'View submitted lesson'
                    }
                    variant="secondary"
                    onPress={() =>
                      navigation.navigate('TeacherLesson', {
                        ...route.params,
                        lesson,
                      })
                    }
                  />
                </SectionCard>
              ))}
            </>
          ) : null}
        </>
      ) : null}
    </DashboardShell>
  );
}
