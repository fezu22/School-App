import React, { useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import type {
  TeacherAssignment,
  TeacherTupleIds,
} from '../../services/teacher/teacherService';
import { assignmentLabel, LoadState, TeacherButton, styles } from './teacherUi';

interface Props {
  assignments: TeacherAssignment[] | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  onOpenRoster: (ids: TeacherTupleIds) => void;
  onOpenAcademic?: (ids: TeacherTupleIds) => void;
  onOpenTimetable?: () => void;
}

export default function TeacherClassesScreen({
  assignments,
  loading,
  error,
  refresh,
  onOpenRoster,
  onOpenAcademic,
  onOpenTimetable,
}: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <View style={styles.page}>
      <FlatList
        data={assignments ?? []}
        extraData={selected}
        keyExtractor={item => item.assignmentId}
        contentContainerStyle={styles.content}
        refreshing={loading}
        onRefresh={() => {
          refresh();
        }}
        ListHeaderComponent={
          <View>
            <Text style={styles.title}>Assigned classes</Text>
            {onOpenTimetable ? (
              <TeacherButton title="Open timetable" onPress={onOpenTimetable} />
            ) : null}
            <LoadState loading={loading} error={error} retry={refresh} />
          </View>
        }
        ListEmptyComponent={
          !loading && !error ? (
            <Text style={styles.body}>No current class assignments.</Text>
          ) : null
        }
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={assignmentLabel(item)}
            accessibilityState={{ selected: selected === item.assignmentId }}
            style={[
              styles.card,
              selected === item.assignmentId && styles.selected,
            ]}
            onPress={() => {
              setSelected(item.assignmentId);
              (onOpenAcademic ?? onOpenRoster)({
                classId: item.classId,
                sectionId: item.sectionId,
                subjectId: item.subjectId,
              });
            }}
          >
            <Text style={styles.body}>
              {item.className} / {item.sectionName}
            </Text>
            <Text style={styles.muted}>{item.subjectName}</Text>
            {selected === item.assignmentId ? (
              <Text style={styles.muted}>Selected assignment</Text>
            ) : null}
          </Pressable>
        )}
      />
    </View>
  );
}
