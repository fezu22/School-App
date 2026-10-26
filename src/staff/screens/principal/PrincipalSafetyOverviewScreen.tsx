import React, { useCallback, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  Button,
  SectionCard,
  ScreenHeading,
} from '../../components/hiraDashboard';
import { DashboardShell } from '../../components/hiraDashboard/DashboardShell';
import { useAuth } from '../../context/AuthContext';
import type { PrincipalStackParamList } from '../../navigation/PrincipalNavigator';
import {
  principalService,
  SafetyAlert,
  SafetyFilters,
} from '../../services/principal/principalService';
import {
  safetyStatuses,
  safetySeverities,
  safetyTypes,
  safetyLabel,
  safetyTime,
  safetyError,
  safetyStyles as styles,
} from './safetyUi';

type Props = NativeStackScreenProps<PrincipalStackParamList, 'SafetyOverview'>;
export default function PrincipalSafetyOverviewScreen({ navigation }: Props) {
  const { accessToken } = useAuth();
  const [alerts, setAlerts] = useState<SafetyAlert[]>([]);
  const [filters, setFilters] = useState<SafetyFilters>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const load = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true);
    setError(null);
    try {
      if (!accessToken)
        throw new Error('Your session is unavailable. Sign in again.');
      const result = await principalService.getSafetyAlerts(
        accessToken,
        filters,
      );
      if (current === generation.current) setAlerts(result.data);
    } catch (failure) {
      if (current === generation.current) setError(safetyError(failure));
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }, [accessToken, filters]);
  useFocusEffect(
    useCallback(() => {
      load().catch(() => undefined);
      return () => {
        ++generation.current;
      };
    }, [load]),
  );
  return (
    <DashboardShell refreshing={loading} onRefresh={load}>
      <Button
        title="Back"
        variant="secondary"
        onPress={() => navigation.goBack()}
      />
      <ScreenHeading
        title="Safety / School Overview"
        subtitle="Operational alerts in your branch"
      />
      <SectionCard title="Filters">
        <Text style={styles.muted}>Status</Text>
        <View style={styles.filters}>
          <Button
            title="Active alerts"
            variant={!filters.status ? 'primary' : 'secondary'}
            onPress={() => setFilters({ ...filters, status: undefined })}
          />
          {safetyStatuses.map(value => (
            <Button
              key={value}
              title={safetyLabel(value)}
              variant={filters.status === value ? 'primary' : 'secondary'}
              onPress={() => setFilters({ ...filters, status: value })}
            />
          ))}
        </View>
        <Text style={styles.muted}>Severity</Text>
        <View style={styles.filters}>
          <Button
            title="All severities"
            variant={!filters.severity ? 'primary' : 'secondary'}
            onPress={() => setFilters({ ...filters, severity: undefined })}
          />
          {safetySeverities.map(value => (
            <Button
              key={value}
              title={safetyLabel(value)}
              variant={filters.severity === value ? 'primary' : 'secondary'}
              onPress={() => setFilters({ ...filters, severity: value })}
            />
          ))}
        </View>
        <Text style={styles.muted}>Category</Text>
        <View style={styles.filters}>
          <Button
            title="All categories"
            variant={!filters.type ? 'primary' : 'secondary'}
            onPress={() => setFilters({ ...filters, type: undefined })}
          />
          {safetyTypes.map(value => (
            <Button
              key={value}
              title={safetyLabel(value)}
              variant={filters.type === value ? 'primary' : 'secondary'}
              onPress={() => setFilters({ ...filters, type: value })}
            />
          ))}
        </View>
      </SectionCard>
      <SectionCard title="Safety alerts">
        <Text style={styles.muted}>
          Up to 100 newest matching alerts. Active alerts excludes resolved
          records.
        </Text>
        {loading ? (
          <Text style={styles.muted}>Loading safety alerts...</Text>
        ) : error ? (
          <View>
            <Text accessibilityRole="alert" style={styles.error}>
              {error}
            </Text>
            <Button title="Retry safety alerts" onPress={load} />
          </View>
        ) : !alerts.length ? (
          <Text style={styles.muted}>
            No safety alerts match the current filters.
          </Text>
        ) : (
          alerts.map(alert => (
            <View key={alert.id} style={styles.actions}>
              <Text style={styles.body}>{alert.title}</Text>
              <Text style={styles.muted}>
                {safetyLabel(alert.type)} · {safetyLabel(alert.severity)} ·{' '}
                {safetyLabel(alert.status)}
              </Text>
              <Text style={styles.muted}>
                Officer:{' '}
                {alert.assignedTo?.fullName || 'Unassigned or unavailable'}
              </Text>
              <Text style={styles.muted}>
                Created: {safetyTime(alert.createdAt)}
              </Text>
              <Text style={styles.muted}>
                Updated: {safetyTime(alert.updatedAt)}
              </Text>
              {alert.capabilities?.canViewDetail ? (
                <Button
                  title={`Open alert: ${alert.title}`}
                  variant="secondary"
                  onPress={() =>
                    navigation.navigate('SafetyDetail', { alertId: alert.id })
                  }
                />
              ) : (
                <Text style={styles.muted}>
                  Detail access requires safety-view permission.
                </Text>
              )}
            </View>
          ))
        )}
      </SectionCard>
    </DashboardShell>
  );
}
