import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import {
  Button,
  Card,
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
import type { PrincipalStackParamList } from '../../navigation/PrincipalNavigator';

type Props = NativeStackScreenProps<PrincipalStackParamList, 'NoticeDetail'>;

export default function NoticeDetailScreen({ route, navigation }: Props) {
  const { accessToken } = useAuth();
  const [notice, setNotice] = useState<SchoolNotice | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!accessToken) {
      setError('Your session is unavailable. Please sign in again.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await principalService.getNotice(
        accessToken,
        route.params.noticeId,
      );
      setNotice(result.data);
    } catch (requestError: unknown) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'Unable to open this school notice.',
      );
    } finally {
      setLoading(false);
    }
  }, [accessToken, route.params.noticeId]);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  return (
    <DashboardShell>
      <Button
        title="Back to inbox"
        variant="secondary"
        onPress={() => navigation.goBack()}
        style={styles.backButton}
      />
      <ScreenHeading
        title="School notice"
        subtitle={
          notice?.priority
            ? `${notice.priority[0].toUpperCase()}${notice.priority.slice(
                1,
              )} priority`
            : undefined
        }
      />
      {loading ? (
        <Card style={styles.state}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.muted}>Loading notice…</Text>
        </Card>
      ) : error ? (
        <Card style={styles.state}>
          <Text style={styles.error}>{error}</Text>
          <Button title="Retry" variant="secondary" onPress={() => load()} />
        </Card>
      ) : notice ? (
        <SectionCard title={notice.title}>
          <Text style={styles.date}>
            {new Date(notice.publishedAt ?? notice.createdAt).toLocaleString()}
          </Text>
          <Text style={styles.message}>{notice.message}</Text>
        </SectionCard>
      ) : null}
    </DashboardShell>
  );
}

const styles = StyleSheet.create({
  backButton: { alignSelf: 'flex-start', marginBottom: 16 },
  state: { alignItems: 'center', gap: 12 },
  date: { ...typography.caption, color: colors.muted, marginBottom: 12 },
  message: { ...typography.body, color: colors.ink },
  muted: { ...typography.small, color: colors.muted },
  error: { ...typography.body, color: colors.danger.text, textAlign: 'center' },
});
