import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing, typography } from '../../theme/hiraDashboard';

type Props = {
  roleLabel: string;
  dateLabel: string;
  title: string;
  subtitle?: string;
  bigValue?: string | number;
  bigValueCaption?: string;
  actionLabel?: string;
  onActionPress?: () => void;
};

/** Yellow banner at the top of staff dashboards (.staff-banner). */
export function HeroBanner(p: Props) {
  return (
    <View style={styles.banner}>
      <View style={styles.top}>
        <Text style={styles.role}>{p.roleLabel}</Text>
        <Text style={styles.date}>{p.dateLabel}</Text>
      </View>
      <View style={styles.main}>
        <View style={styles.copy}>
          <Text style={styles.title}>{p.title}</Text>
          {p.subtitle ? <Text style={styles.sub}>{p.subtitle}</Text> : null}
        </View>
        {p.bigValue !== undefined && (
          <View style={styles.valueBox}>
            <Text style={styles.big}>{p.bigValue}</Text>
            {p.bigValueCaption ? (
              <Text style={styles.bigCaption}>{p.bigValueCaption}</Text>
            ) : null}
          </View>
        )}
      </View>
      {p.actionLabel ? (
        <Pressable
          onPress={p.onActionPress}
          style={({ pressed }) => [
            styles.action,
            pressed && { backgroundColor: colors.primaryPressed },
          ]}
        >
          <Text style={styles.actionText}>{p.actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  copy: { flex: 1 },
  banner: {
    backgroundColor: colors.hero,
    borderColor: colors.heroBorder,
    borderWidth: 1,
    borderRadius: radius.hero,
    padding: 19,
    marginBottom: spacing.xl,
  },
  top: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  role: {
    fontFamily: typography.button.fontFamily,
    fontSize: 10,
    letterSpacing: 1.7,
    color: colors.heroLabel,
  },
  date: {
    fontFamily: typography.body.fontFamily,
    fontSize: 10,
    color: colors.heroLabel,
    backgroundColor: '#fff9ed',
    borderColor: '#efdab4',
    borderWidth: 1,
    borderRadius: 5,
    paddingHorizontal: 8,
    paddingVertical: 4,
    overflow: 'hidden',
  },
  main: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 18,
  },
  title: { ...typography.h2, color: colors.ink },
  sub: {
    ...typography.small,
    color: colors.heroText,
    marginTop: 8,
    maxWidth: 220,
  },
  valueBox: {
    alignItems: 'center',
    borderLeftWidth: 1,
    borderLeftColor: '#e3c697',
    paddingLeft: 12,
    minWidth: 68,
  },
  big: { ...typography.bigNumber, color: colors.ink },
  bigCaption: { fontSize: 11, color: colors.heroText, marginTop: 6 },
  action: {
    alignSelf: 'flex-start',
    backgroundColor: colors.primary,
    borderRadius: 7,
    minHeight: 40,
    paddingHorizontal: 13,
    justifyContent: 'center',
  },
  actionText: { ...typography.button, fontSize: 13, color: colors.white },
});
