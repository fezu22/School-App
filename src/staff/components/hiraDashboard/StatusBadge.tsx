import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { colors, typography } from '../../theme/hiraDashboard';

export type PaymentStatus = 'paid' | 'unpaid' | 'pending';

/** Paid / Unpaid / Pending chip (.finance-status). */
export function StatusBadge({
  status,
  label,
}: {
  status: PaymentStatus;
  label?: string;
}) {
  const c = colors[status];
  return (
    <Text style={[styles.badge, { backgroundColor: c.bg, color: c.text }]}>
      {label ?? status.charAt(0).toUpperCase() + status.slice(1)}
    </Text>
  );
}

const styles = StyleSheet.create({
  badge: {
    ...typography.caption,
    fontFamily: typography.bodyStrong.fontFamily,
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 6,
    overflow: 'hidden',
    maxWidth: 95,
  },
});
