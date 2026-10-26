import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, typography } from '../../theme/hiraDashboard';

export type QuickItem = { label: string; icon: string; onPress?: () => void };

/** 4-up shortcut grid (.quick-grid / .quick). */
export function QuickActions({ items }: { items: QuickItem[] }) {
  return (
    <View style={styles.grid}>
      {items.map(it => (
        <Pressable key={it.label} onPress={it.onPress} style={styles.quick}>
          <View style={styles.iconTile}>
            <Text style={styles.icon}>{it.icon}</Text>
          </View>
          <Text style={styles.label} numberOfLines={2}>
            {it.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', gap: 7, marginTop: 6 },
  quick: {
    flex: 1,
    alignItems: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 4,
    backgroundColor: colors.cardWarm,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.sm,
  },
  iconTile: {
    width: 38,
    height: 38,
    borderRadius: radius.sm,
    backgroundColor: colors.soft,
    borderColor: colors.softBorder,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: { fontSize: 20, color: colors.primary },
  label: {
    ...typography.caption,
    fontFamily: typography.bodyStrong.fontFamily,
    color: colors.primary,
    textAlign: 'center',
  },
});
