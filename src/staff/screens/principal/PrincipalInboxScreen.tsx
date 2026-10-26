import React, { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  Button,
  ScreenHeading,
  SectionCard,
} from '../../components/hiraDashboard';
import { DashboardShell } from '../../components/hiraDashboard/DashboardShell';
import { useAuth } from '../../context/AuthContext';
import {
  principalService,
  SchoolNotice,
} from '../../services/principal/principalService';
import { colors, typography } from '../../theme/hiraDashboard';

interface PrincipalInboxScreenProps {
  onOpenNotice: (noticeId: string) => void;
}

const noticeDate = (notice: SchoolNotice): string => {
  const rawDate = notice.publishedAt ?? notice.createdAt;
  const date = new Date(rawDate);
  return Number.isNaN(date.getTime())
    ? rawDate
    : date.toLocaleDateString('en-PK', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
};

export default function PrincipalInboxScreen({
  onOpenNotice,
}: PrincipalInboxScreenProps) {
  const { accessToken } = useAuth();
  const [notices, setNotices] = useState<SchoolNotice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);

  const load = useCallback(async () => {
    const current = ++generation.current;
    if (!accessToken) {
      setError('Your session is unavailable. Please sign in again.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await principalService.getNotices(accessToken);
      if (current === generation.current) setNotices(response.data);
    } catch (requestError: unknown) {
      if (current === generation.current)
        setError(
          requestError instanceof Error
            ? requestError.message
            : 'Unable to load school notices.',
        );
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }, [accessToken]);

  useFocusEffect(
    useCallback(() => {
      load().catch(() => undefined);
      return () => {
        ++generation.current;
      };
    }, [load]),
  );

  return (
    <DashboardShell
      safeArea={false}
      refreshing={loading}
      onRefresh={() => load()}
    >
      <ScreenHeading
        title="A little conversation goes a long way."
        subtitle="Published school notices from your branch."
      />
      <SectionCard title="School inbox">
        {loading && notices.length === 0 ? (
          <View>
            {[0, 1, 2].map(index => (
              <View key={index} style={styles.skeletonRow}>
                <View style={styles.skeletonIcon} />
                <View style={styles.skeletonCopy}>
                  <View style={styles.skeletonTitle} />
                  <View style={styles.skeletonSubtitle} />
                  <View style={styles.skeletonPreview} />
                </View>
                <View style={styles.skeletonChip} />
              </View>
            ))}
          </View>
        ) : error ? (
          <View style={styles.state}>
            <Text style={styles.body}>{error}</Text>
            <Button title="Retry" variant="secondary" onPress={() => load()} />
          </View>
        ) : notices.length === 0 ? (
          <View style={styles.state}>
            <Text style={styles.title}>No school notices</Text>
            <Text style={styles.muted}>
              Published school notices will appear here.
            </Text>
          </View>
        ) : (
          notices.map((notice, index) => (
            <Pressable
              key={notice._id}
              accessibilityRole="button"
              accessibilityLabel={`View notice: ${notice.title}`}
              onPress={() => onOpenNotice(notice._id)}
              style={({ pressed }) => [
                styles.row,
                index < notices.length - 1 && styles.divider,
                pressed && styles.pressed,
              ]}
            >
              <View style={styles.iconTile}>
                <Text style={styles.icon}>✉</Text>
              </View>
              <View style={styles.rowCopy}>
                <Text style={styles.sender}>
                  School notice · {noticeDate(notice)}
                </Text>
                <Text style={styles.title} numberOfLines={1}>
                  {notice.title}
                </Text>
                <Text style={styles.preview} numberOfLines={2}>
                  {notice.message}
                </Text>
              </View>
              <View style={styles.right}>
                <Text
                  style={[styles.priority, priorityStyles[notice.priority]]}
                >
                  {notice.priority}
                </Text>
                <Text style={styles.action}>View</Text>
              </View>
            </Pressable>
          ))
        )}
      </SectionCard>
    </DashboardShell>
  );
}

const priorityStyles = {
  low: { backgroundColor: colors.soft, color: colors.primary },
  normal: { backgroundColor: colors.soft, color: colors.primary },
  high: { backgroundColor: colors.pending.bg, color: colors.pending.text },
  urgent: { backgroundColor: colors.danger.bg, color: colors.danger.text },
} as const;

const styles = StyleSheet.create({
  skeletonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 15,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  skeletonIcon: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: '#f0eee9',
  },
  skeletonCopy: { flex: 1, gap: 7 },
  skeletonTitle: {
    height: 10,
    width: '48%',
    borderRadius: 5,
    backgroundColor: '#f0eee9',
  },
  skeletonSubtitle: {
    height: 12,
    width: '76%',
    borderRadius: 6,
    backgroundColor: '#f0eee9',
  },
  skeletonPreview: {
    height: 10,
    width: '90%',
    borderRadius: 5,
    backgroundColor: '#f0eee9',
  },
  skeletonChip: {
    height: 24,
    width: 54,
    borderRadius: 6,
    backgroundColor: '#eff0ff',
  },
  state: { alignItems: 'center', gap: 12, paddingVertical: 24 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 14,
  },
  divider: { borderBottomWidth: 1, borderBottomColor: colors.border },
  pressed: { opacity: 0.75 },
  iconTile: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: colors.soft,
    borderWidth: 1,
    borderColor: colors.softBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: { color: colors.primary, fontSize: 17 },
  rowCopy: { flex: 1, gap: 3 },
  sender: { ...typography.caption, color: colors.muted },
  title: { ...typography.bodyStrong, color: colors.ink },
  preview: { ...typography.small, color: colors.muted },
  right: { alignItems: 'flex-end', gap: 8 },
  priority: {
    ...typography.caption,
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 4,
    overflow: 'hidden',
    textTransform: 'capitalize',
  },
  action: { ...typography.bodyStrong, color: colors.primary },
  muted: { ...typography.caption, color: colors.muted },
  body: { ...typography.body, color: colors.ink, textAlign: 'center' },
});
