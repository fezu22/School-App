import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  colors,
  radius,
  spacing,
  typography,
  flatShadow,
} from '../../theme/hiraDashboard';

type Props = {
  icon: string;
  label: string;
  value: string | number;
  foot?: string;
  /** 0-3: picks the coloured top border used on the dashboard */
  accentIndex?: number;
  onPress?: () => void;
};

/** Dashboard stat tile (.stat). */
export function StatCard({
  icon,
  label,
  value,
  foot,
  accentIndex = 0,
  onPress,
}: Props) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={[
        styles.card,
        { borderTopColor: colors.statAccent[accentIndex % 4] },
      ]}
    >
      <View style={styles.icon}>
        <Text style={styles.iconText}>{icon}</Text>
      </View>
      <Text style={styles.value}>{value}</Text>
      <Text style={styles.label}>{label}</Text>
      {foot ? <Text style={styles.foot}>{foot}</Text> : null}
    </Pressable>
  );
}

/** 2 x 2 grid of StatCards (mobile layout of .stats). */
export function StatGrid({ children }: { children: React.ReactNode }) {
  const items = React.Children.toArray(children);
  const rows = [];
  for (let i = 0; i < items.length; i += 2) {
    rows.push(
      <View key={i} style={styles.gridRow}>
        {items[i]}
        {items[i + 1]}
      </View>,
    );
  }
  return <View style={styles.grid}>{rows}</View>;
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    minWidth: 0,
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderTopWidth: 3,
    borderRadius: radius.lg,
    padding: spacing.md + 2,
    ...flatShadow,
  },
  icon: {
    height: 36,
    width: 36,
    borderRadius: radius.sm,
    backgroundColor: colors.soft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconText: { fontSize: 18 },
  value: { ...typography.statValue, color: colors.ink, marginTop: 8 },
  label: { ...typography.bodyStrong, color: colors.ink, marginTop: 2 },
  foot: { ...typography.caption, color: colors.muted, marginTop: 6 },
  grid: { gap: 12, marginBottom: spacing.xl },
  gridRow: { flexDirection: 'row', gap: 12 },
});
