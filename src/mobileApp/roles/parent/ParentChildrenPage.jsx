import React, { useEffect, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { parentApi } from './parentService';
import { parentPreview } from '../../shared/data/previewData';
import PageIcon from '../../shared/components/PageIcon';
import { theme as t } from '../../theme/hiraTheme';
import {
  Action,
  Hero,
  PreviewNote,
  State,
  childClass,
  childName,
  recordId,
  rows,
  u,
  useParentChildren,
} from './ParentWorkspaceUI';

function ChildCard({ child, preview, onNavigate }) {
  const [summary, setSummary] = useState(null);
  useEffect(() => {
    let alive = true;
    setSummary(null);
    const id = recordId(child);
    const source = parentPreview.records[id];
    Promise.allSettled([
      preview
        ? Promise.resolve(source?.attendance)
        : parentApi.getAttendance(id),
      preview ? Promise.resolve(source?.homework) : parentApi.getHomework(id),
    ]).then(([attendance, homework]) => {
      if (!alive) return;
      const today = new Date();
      const date = `${today.getFullYear()}-${String(
        today.getMonth() + 1,
      ).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      const todayRows = rows(attendance.value).filter(
        item =>
          String(item.date || item.attendanceDate || '').slice(0, 10) === date,
      );
      const statuses = [
        ...new Set(todayRows.map(item => item.status).filter(Boolean)),
      ];
      setSummary({
        attendance:
          attendance.status === 'rejected'
            ? 'Unavailable'
            : statuses.length === 1
            ? String(statuses[0])
            : statuses.length > 1
            ? 'View attendance'
            : 'Not marked today',
        homework:
          homework.status === 'rejected'
            ? 'Unavailable'
            : `${rows(homework.value).length} assigned`,
      });
    });
    return () => {
      alive = false;
    };
  }, [child, preview]);
  return (
    <View style={u.card}>
      <View style={u.row}>
        <View style={u.avatar}>
          <PageIcon name="users" size={32} color={t.primary} />
        </View>
        <View style={u.flex}>
          <Text style={u.title}>{childName(child)}</Text>
          <Text style={u.body}>{childClass(child)}</Text>
          <Text style={u.muted}>Student ID: {recordId(child)}</Text>
        </View>
      </View>
      <View style={u.row}>
        <View style={u.metric}>
          <Text style={u.muted}>Attendance</Text>
          <Text style={u.label}>{summary?.attendance || 'Loading…'}</Text>
        </View>
        <View style={u.metric}>
          <Text style={u.muted}>Homework</Text>
          <Text style={u.label}>{summary?.homework || 'Loading…'}</Text>
        </View>
      </View>
      <Action
        title="View child"
        label={`View ${childName(child)}`}
        onPress={() => onNavigate('Student Progress Tracking', recordId(child))}
      />
    </View>
  );
}
export default function ParentChildrenPage({
  previewOnly = false,
  initialChildId = '',
  onChildChange,
  onNavigate,
}) {
  const model = useParentChildren(previewOnly, initialChildId, onChildChange);
  return (
    <ScrollView
      contentContainerStyle={u.page}
      refreshControl={
        <RefreshControl
          refreshing={model.loading}
          onRefresh={model.refresh}
          tintColor={t.primary}
        />
      }
    >
      <PreviewNote visible={model.preview} />
      <Hero
        title="Their school day, at a glance"
        subtitle="Attendance, homework and progress, together."
        icon="users"
      />
      {model.loading ? (
        <State loading title="Loading your children…" />
      ) : model.error ? (
        <State
          error
          title="Children could not load"
          detail={model.error}
          onRetry={model.refresh}
        />
      ) : !model.children.length ? (
        <State
          title="No linked children yet"
          detail="Ask your school to verify your parent–child link."
        />
      ) : (
        model.children.map(child => (
          <ChildCard
            key={recordId(child)}
            child={child}
            preview={model.preview}
            onNavigate={onNavigate}
          />
        ))
      )}
      {!!model.children.length && (
        <View style={u.hero}>
          <PageIcon name="school" size={34} color={t.primary} />
          <Text style={[u.muted, u.flex]}>
            Choose a child to see their school records.
          </Text>
        </View>
      )}
    </ScrollView>
  );
}
