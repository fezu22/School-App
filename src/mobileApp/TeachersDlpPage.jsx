import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { theme as t } from './theme/hiraTheme';

export default function TeachersDlpPage({ previewOnly = false }) {
  return (
    <View style={styles.page}>
      <Text style={styles.eyebrow}>TEACHER RECORDS</Text>
      <Text style={styles.title}>Teachers DLP</Text>
      <Text style={styles.subtitle}>
        Teacher DLP records are shown only when an authorized school API is
        available for this role.
      </Text>
      <View style={styles.empty}>
        <Text style={styles.emptyTitle}>No teacher DLP records available</Text>
        <Text style={styles.emptyText}>
          {previewOnly
            ? 'Preview mode does not create fictional teacher records.'
            : 'This mobile project has no authorized teacher DLP list endpoint connected yet.'}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: t.background, padding: 20 },
  eyebrow: { color: t.muted, fontSize: 10, fontWeight: '800', letterSpacing: 1.4 },
  title: { color: t.ink, fontSize: 28, fontWeight: '900', marginTop: 9 },
  subtitle: { color: t.muted, fontSize: 13, lineHeight: 20, marginTop: 8 },
  empty: { backgroundColor: t.paper, borderColor: t.border, borderWidth: 1, borderRadius: 18, padding: 18, marginTop: 25, ...t.shadow },
  emptyTitle: { color: t.ink, fontSize: 16, fontWeight: '800' },
  emptyText: { color: t.muted, fontSize: 13, lineHeight: 20, marginTop: 7 },
});
