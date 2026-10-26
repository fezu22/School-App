import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, typography } from '../../theme/hiraDashboard';

/** Page title + muted subtitle (.heading). */
export function ScreenHeading({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.h1}>{title}</Text>
      {subtitle ? <Text style={styles.sub}>{subtitle}</Text> : null}
    </View>
  );
}

export function DemoNote({ children }: { children: string }) {
  return <Text style={styles.note}>{children}</Text>;
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 18 },
  h1: { ...typography.h1, color: colors.ink },
  sub: { ...typography.body, color: colors.muted, marginTop: 4 },
  note: {
    ...typography.small,
    color: colors.muted,
    marginTop: 4,
    marginBottom: 24,
  },
});
