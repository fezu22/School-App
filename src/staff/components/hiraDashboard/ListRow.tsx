import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, spacing, typography } from '../../theme/hiraDashboard';

type Props = {
  icon: string;
  title: string;
  subtitle?: string;
  tag?: string; // small pill on the right (.staff-entry em)
  right?: React.ReactNode; // e.g. <StatusBadge/>
  last?: boolean;
  onPress?: () => void;
};

/** Row with soft icon tile, title, subtitle, divider (.staff-entry / .finance-record). */
export function ListRow({
  icon,
  title,
  subtitle,
  tag,
  right,
  last,
  onPress,
}: Props) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        !last && styles.divider,
        pressed && { backgroundColor: colors.background },
      ]}
    >
      <View style={styles.icon}>
        <Text style={styles.glyph}>{icon}</Text>
      </View>
      <View style={styles.body}>
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.sub}>{subtitle}</Text> : null}
      </View>
      {tag ? <Text style={styles.tag}>{tag}</Text> : null}
      {right}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  glyph: { fontSize: 17 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 15,
  },
  divider: { borderBottomWidth: 1, borderBottomColor: colors.border },
  icon: {
    width: 36,
    height: 36,
    borderRadius: 9,
    backgroundColor: colors.soft,
    borderWidth: 1,
    borderColor: colors.softBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1, minWidth: 0, gap: 5 },
  title: { ...typography.bodyStrong, color: colors.ink },
  sub: { ...typography.small, color: colors.muted },
  tag: {
    fontFamily: typography.button.fontFamily,
    fontSize: 10,
    color: colors.primary,
    backgroundColor: colors.soft,
    borderRadius: 5,
    paddingHorizontal: 7,
    paddingVertical: 5,
    maxWidth: 76,
    textAlign: 'center',
    overflow: 'hidden',
    marginLeft: spacing.xs,
  },
});
