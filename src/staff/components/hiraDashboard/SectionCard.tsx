import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Card } from './Card';
import { colors, typography } from '../../theme/hiraDashboard';

type Props = {
  title: string;
  /** Text link on the right of the title, e.g. "Full timetable" */
  linkLabel?: string;
  onLinkPress?: () => void;
  children: React.ReactNode;
};

/** Titled white card used for every dashboard section (.panel + .panel-head + .link-btn). */
export function SectionCard({
  title,
  linkLabel,
  onLinkPress,
  children,
}: Props) {
  return (
    <Card>
      <View style={styles.head}>
        <Text style={styles.title}>{title}</Text>
        {linkLabel ? (
          <Pressable onPress={onLinkPress} hitSlop={8}>
            <Text style={styles.link}>{linkLabel}</Text>
          </Pressable>
        ) : null}
      </View>
      {children}
    </Card>
  );
}

const styles = StyleSheet.create({
  head: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  title: { ...typography.h3, color: colors.ink },
  link: { ...typography.bodyStrong, fontSize: 13, color: colors.primary },
});
