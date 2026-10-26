import React from 'react';
import { StyleSheet, View, ViewProps } from 'react-native';
import { colors, radius, spacing, cardShadow } from '../../theme/hiraDashboard';

/** Base white panel (.panel). */
export function Card({ style, ...rest }: ViewProps) {
  return <View {...rest} style={[styles.card, style]} />;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderBottomWidth: 4, // stands in for the 0 6px 0 solid edge
    borderBottomColor: colors.shadowSolid,
    borderRadius: radius.card,
    padding: spacing.lg,
    marginBottom: spacing.lg,
    ...cardShadow,
  },
});
