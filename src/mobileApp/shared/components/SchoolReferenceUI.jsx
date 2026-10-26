import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

// Native equivalents of the demo's panel, row, badge and stat primitives.
export const schoolColors = {
  ink: '#2C3556',
  muted: '#74868E',
  primary: '#4B56BD',
  background: '#FFF9F0',
  line: '#EEE1D0',
  green: '#E9F2DE',
};

export function SchoolPanel({ title, children, style }) {
  return (
    <View style={[styles.panel, style]}>
      {title ? <Text style={styles.panelTitle}>{title}</Text> : null}
      {children}
    </View>
  );
}

export function SchoolBadge({ children }) {
  return (
    <View style={styles.badge}>
      <Text style={styles.badgeText}>{children}</Text>
    </View>
  );
}

export function SchoolRow({
  icon,
  title,
  subtitle,
  badge,
  action = 'View',
  onPress,
  last = false,
  disabled = false,
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${subtitle || ''}. ${action}`}
      accessibilityState={{ disabled }}
      disabled={disabled || !onPress}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        !last && styles.divider,
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.rowIcon}>
        <Text style={styles.emoji}>{icon}</Text>
      </View>
      <View style={styles.rowCopy}>
        <Text style={styles.rowTitle}>{title}</Text>
        {subtitle ? <Text style={styles.rowSubtitle}>{subtitle}</Text> : null}
      </View>
      {badge ? <SchoolBadge>{badge}</SchoolBadge> : null}
      <Text style={[styles.link, disabled && styles.disabled]}>{action}</Text>
    </Pressable>
  );
}

export function SchoolMetric({
  label,
  value,
  note,
  icon,
  color = '#E9E9FF',
  onPress,
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}`}
      onPress={onPress}
      style={({ pressed }) => [styles.metric, pressed && styles.pressed]}
    >
      <View style={styles.metricTop}>
        <Text style={styles.metricLabel}>{label}</Text>
        <View style={[styles.metricIcon, { backgroundColor: color }]}>
          <Text style={styles.emoji}>{icon}</Text>
        </View>
      </View>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricNote}>{note}</Text>
    </Pressable>
  );
}

export function SchoolQuickActions({ actions }) {
  return (
    <View style={styles.quicks}>
      {actions.map(item => (
        <Pressable
          key={item.label}
          accessibilityRole="button"
          onPress={item.onPress}
          accessibilityLabel={item.label}
          style={({ pressed }) => [styles.quick, pressed && styles.pressed]}
        >
          <Text style={styles.quickIcon}>{item.icon}</Text>
          <Text style={styles.quickLabel}>{item.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export const schoolStyles = StyleSheet.create({
  page: { paddingHorizontal: 18, paddingTop: 20, paddingBottom: 28, gap: 18 },
  title: {
    color: schoolColors.ink,
    fontSize: 26,
    lineHeight: 32,
    fontWeight: '800',
    letterSpacing: -0.7,
  },
  subtitle: {
    color: schoolColors.muted,
    fontSize: 13,
    lineHeight: 21,
    marginTop: 6,
  },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  preview: { color: schoolColors.muted, fontSize: 11, lineHeight: 16 },
});

const styles = StyleSheet.create({
  panel: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: schoolColors.line,
    padding: 17,
    marginBottom: 4,
    shadowColor: '#C5B397',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 0,
    elevation: 2,
  },
  panelTitle: {
    color: schoolColors.ink,
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '800',
    marginBottom: 16,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 17,
    minHeight: 100,
  },
  divider: { borderBottomWidth: 1, borderBottomColor: '#F0EEE7' },
  rowIcon: {
    width: 40,
    height: 40,
    borderRadius: 13,
    backgroundColor: '#F4F0DF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emoji: { fontSize: 22 },
  rowCopy: { flex: 1, minWidth: 0 },
  rowTitle: {
    color: schoolColors.ink,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '700',
  },
  rowSubtitle: {
    color: schoolColors.muted,
    fontSize: 13,
    lineHeight: 17,
    marginTop: 4,
  },
  badge: {
    backgroundColor: schoolColors.green,
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 6,
    flexShrink: 1,
  },
  badgeText: { color: '#58784D', fontSize: 11, fontWeight: '700' },
  link: {
    color: schoolColors.primary,
    fontSize: 12,
    fontWeight: '700',
    paddingVertical: 10,
    minWidth: 34,
    textAlign: 'right',
  },
  disabled: { color: schoolColors.muted },
  pressed: { opacity: 0.75 },
  metric: {
    width: '47.8%',
    flexGrow: 1,
    flexBasis: '46%',
    minHeight: 120,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: schoolColors.line,
    backgroundColor: '#FFFFFF',
    padding: 14,
    shadowColor: '#C5B397',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 0,
    elevation: 2,
  },
  metricTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 5,
  },
  metricLabel: { color: schoolColors.muted, fontSize: 12, flex: 1 },
  metricIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ rotate: '-7deg' }],
  },
  metricValue: {
    color: '#44466B',
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '800',
    marginTop: 9,
  },
  metricNote: { color: '#83938F', fontSize: 11, lineHeight: 16, marginTop: 5 },
  quicks: { flexDirection: 'row', gap: 7 },
  quick: {
    flex: 1,
    minHeight: 80,
    backgroundColor: '#FCFCF8',
    borderWidth: 1,
    borderColor: schoolColors.line,
    borderRadius: 15,
    paddingHorizontal: 3,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
  },
  quickIcon: { fontSize: 24 },
  quickLabel: { fontSize: 11, color: schoolColors.ink },
});
