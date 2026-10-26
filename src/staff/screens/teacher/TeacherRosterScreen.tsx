import React, { useCallback, useState } from 'react';
import { FlatList, Text, TextInput, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { TeacherStackParamList } from '../../navigation/TeacherNavigator';
import { useAuth } from '../../context/AuthContext';
import { teacherService } from '../../services/teacher/teacherService';
import { useTeacherResource } from './useTeacherResource';
import { assignmentLabel, LoadState, styles } from './teacherUi';

export default function TeacherRosterScreen({
  route,
}: NativeStackScreenProps<TeacherStackParamList, 'TeacherRoster'>) {
  const { accessToken } = useAuth();
  const { classId, sectionId, subjectId } = route.params;
  const [query, setQuery] = useState('');
  const load = useCallback(() => {
    if (!accessToken)
      return Promise.reject(new Error('Authentication required.'));
    return teacherService.getRoster(accessToken, {
      classId,
      sectionId,
      subjectId,
    });
  }, [accessToken, classId, sectionId, subjectId]);
  const resource = useTeacherResource(load);
  const normalized = query.trim().toLocaleLowerCase();
  const students =
    resource.data?.students.filter(student =>
      `${student.fullName} ${student.admissionNumber}`
        .toLocaleLowerCase()
        .includes(normalized),
    ) ?? [];
  return (
    <View style={styles.shell}>
      <FlatList
        data={students}
        keyExtractor={student => student.studentId}
        contentContainerStyle={styles.content}
        refreshing={resource.loading}
        onRefresh={() => {
          resource.refresh();
        }}
        ListHeaderComponent={
          <View style={styles.content}>
            <Text style={styles.title}>Assigned roster</Text>
            {resource.data ? (
              <Text style={styles.body}>
                {assignmentLabel(resource.data.assignment)}
              </Text>
            ) : null}
            <LoadState
              loading={resource.loading}
              error={resource.error}
              retry={resource.refresh}
              label="Loading roster..."
            />
            <TextInput
              style={styles.search}
              accessibilityLabel="Search roster"
              placeholder="Search name or admission number"
              value={query}
              onChangeText={setQuery}
            />
          </View>
        }
        ListEmptyComponent={
          !resource.loading && !resource.error ? (
            <Text style={styles.body}>
              {normalized
                ? 'No matching students.'
                : 'No active students in this assigned section.'}
            </Text>
          ) : null
        }
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.body}>{item.fullName}</Text>
            <Text style={styles.muted}>Admission: {item.admissionNumber}</Text>
          </View>
        )}
      />
    </View>
  );
}
