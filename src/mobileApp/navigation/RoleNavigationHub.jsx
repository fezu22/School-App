import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import PageIcon from '../shared/components/PageIcon';
import { theme as t } from '../theme/hiraTheme';
import { Hero, u, ChildSelector, useParentChildren } from '../roles/parent/ParentWorkspaceUI';
import { getRoleNavigationGroups } from './roleNavigation';

const descriptions = {
  Homework: 'View assignments and teacher feedback',
  'Recorded Lessons': 'Revisit published classroom lessons',
  'Learning Resources': 'Books, worksheets and useful links',
  'Notes & Flashcards': 'Review saved notes and flashcards',
  Quiz: 'Open your assigned practice quizzes',
  'Revision Planner': 'Plan your next learning steps',
  Results: 'View published exam results',
  'Academic Report': 'Follow academic performance',
  'Monthly Feedback': 'Read teacher feedback',
  'Student Progress Tracking': 'Your child’s school story',
  Progress: 'Your learning progress',
  'Personal & Behaviour Report': 'Read personal development reports',
  'Academic Calendar': 'School dates and examinations',
  'Attendance Calendar': 'Review attendance by date',
  'School Events': 'Upcoming school events',
  'Sports & Activities': 'Explore school activities',
  'PTM & Appointments': 'Parent–teacher meetings',
  'Student Fees': 'View fees and payment options',
  'Receipt Details': 'Confirmed payment receipts',
  'Installment Requests': 'Your fee installment requests',
};
function ParentSectionChild({ previewOnly, initialChildId, onChildChange }) {
  const model = useParentChildren(previewOnly, initialChildId, onChildChange);
  return model.selected ? <ChildSelector model={model} /> : null;
}
export default function RoleNavigationHub({
  role,
  page,
  route,
  authorizedPages,
  onNavigate,
  onBack,
  previewOnly,
  initialChildId,
  onChildChange,
}) {
  const group = getRoleNavigationGroups(role, authorizedPages).find(
    item => item.title === page,
  );
  if (!group) return null;
  if (route)
    return (
      <View style={styles.backWrap}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Back to ${page}`}
          onPress={() => (onBack ? onBack() : onNavigate(page))}
          style={u.back}
        >
          <Text style={u.link}>‹ {page}</Text>
        </Pressable>
      </View>
    );
  return (
    <ScrollView contentContainerStyle={u.page}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back to Home"
        onPress={() => onNavigate('Home')}
        style={u.back}
      >
        <Text style={u.link}>‹ Back to Home</Text>
      </Pressable>
      {role === 'Parent' && (
        <ParentSectionChild
          previewOnly={previewOnly}
          initialChildId={initialChildId}
          onChildChange={onChildChange}
        />
      )}
      <Hero
        title={
          page === 'Learning'
            ? 'A little learning, every day'
            : page === 'Reports'
            ? 'Their progress, clearly shared'
            : page === 'Fees & Payments'
            ? 'School fees, all together'
            : 'Good days, planned ahead'
        }
        subtitle="Choose a page to get started."
        icon={page}
      />
      <Text style={u.title}>
        {page === 'Learning' ? 'Explore learning' : page}
      </Text>
      <View style={styles.grid}>
        {group.routes.map((item, index) => (
          <Pressable
            key={item}
            accessibilityRole="button"
            accessibilityLabel={`Open ${item}`}
            onPress={() => onNavigate(item)}
            style={({ pressed }) => [
              styles.tile,
              {
                backgroundColor: ['#F1F4FD', '#FFF1F6', '#EFF7F0', '#FFF7E6'][
                  index % 4
                ],
              },
              pressed && u.pressed,
            ]}
          >
            <View style={u.row}>
              <PageIcon name={item} size={30} color={t.primary} />
              <View style={u.flex} />
              <PageIcon name="chevron" size={16} color={t.primary} />
            </View>
            <Text style={u.cardTitle}>{item}</Text>
            <Text style={u.muted}>
              {descriptions[item] || 'Open this learning page'}
            </Text>
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
}
const styles = StyleSheet.create({
  backWrap: { paddingHorizontal: 18 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  tile: {
    flexGrow: 1,
    flexBasis: '45%',
    minWidth: 135,
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: 22,
    padding: 16,
    gap: 12,
    minHeight: 150,
  },
});
