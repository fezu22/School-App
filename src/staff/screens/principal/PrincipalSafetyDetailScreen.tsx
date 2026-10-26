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
  SafetyAction,
  TaskUser,
} from '../../services/principal/principalService';
import {
  safetyActions,
  safetyLabel,
  safetyTime,
  safetyError,
  safetyStyles as styles,
} from './safetyUi';

type Props = NativeStackScreenProps<PrincipalStackParamList, 'SafetyDetail'>;
export default function PrincipalSafetyDetailScreen({
  route,
  navigation,
}: Props) {
  const { accessToken } = useAuth();
  const [alert, setAlert] = useState<SafetyAlert | null>(null);
  const [verified, setVerified] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [officers, setOfficers] = useState<TaskUser[]>([]);
  const [selected, setSelected] = useState('');
  const [officersLoading, setOfficersLoading] = useState(false);
  const [officersError, setOfficersError] = useState<string | null>(null);
  const lock = useRef(false);
  const generation = useRef(0);
  const officerGeneration = useRef(0);
  const apply = useCallback((next: SafetyAlert) => {
    setAlert(next);
    setVerified(true);
    if (!safetyActions(next).includes('assign')) {
      setAssigning(false);
      setSelected('');
      setOfficers([]);
      ++officerGeneration.current;
    }
    if (!safetyActions(next).includes('resolve')) setReviewing(false);
  }, []);
  const load = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true);
    setVerified(false);
    setLoadError(null);
    try {
      if (!accessToken)
        throw new Error('Your session is unavailable. Sign in again.');
      const result = await principalService.getSafetyAlert(
        accessToken,
        route.params.alertId,
      );
      if (current === generation.current) apply(result.data);
    } catch (failure) {
      if (current === generation.current) setLoadError(safetyError(failure));
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }, [accessToken, route.params.alertId, apply]);
  useFocusEffect(
    useCallback(() => {
      load().catch(() => undefined);
      return () => {
        ++generation.current;
        ++officerGeneration.current;
      };
    }, [load]),
  );
  const fetchOfficers = async () => {
    if (
      !accessToken ||
      !alert ||
      !verified ||
      lock.current ||
      !safetyActions(alert).includes('assign')
    )
      return;
    const current = ++officerGeneration.current;
    setAssigning(true);
    setReviewing(false);
    setOfficers([]);
    setSelected('');
    setOfficersLoading(true);
    setOfficersError(null);
    setActionError(null);
    setSuccess('');
    try {
      const result = await principalService.getSafetyOfficers(
        accessToken,
        alert.id,
      );
      if (current === officerGeneration.current) setOfficers(result.data);
    } catch (failure) {
      if (current === officerGeneration.current)
        setOfficersError(safetyError(failure));
    } finally {
      if (current === officerGeneration.current) setOfficersLoading(false);
    }
  };
  const submit = async (action: SafetyAction) => {
    if (
      !accessToken ||
      !alert ||
      !verified ||
      lock.current ||
      !safetyActions(alert).includes(action)
    )
      return;
    if (
      action === 'assign' &&
      !officers.some(officer => officer._id === selected)
    ) {
      setActionError('Select an eligible officer.');
      return;
    }
    lock.current = true;
    ++generation.current;
    ++officerGeneration.current;
    setBusy(true);
    setSuccess('');
    setActionError(null);
    try {
      const result = await principalService.processSafetyAlert(
        accessToken,
        alert.id,
        action,
        action === 'assign' ? selected : undefined,
      );
      apply(result.data);
      setSuccess(result.message);
      setAssigning(false);
      setReviewing(false);
      setSelected('');
      setOfficers([]);
    } catch (failure) {
      setActionError(safetyError(failure, true));
      // Reconcile uncertain or stale writes before allowing another action.
      setAssigning(false);
      setReviewing(false);
      setSelected('');
      setOfficers([]);
      await load();
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const actions = alert && verified ? safetyActions(alert) : [];
  return (
    <DashboardShell refreshing={loading} onRefresh={busy ? undefined : load}>
      <Button
        title="Back to safety overview"
        variant="secondary"
        disabled={busy}
        onPress={() => navigation.goBack()}
      />
      <ScreenHeading title="Safety alert detail" />
      <Button
        title="Refresh alert"
        variant="secondary"
        disabled={busy || loading}
        onPress={load}
      />
      {loading ? (
        <Text style={styles.muted}>Loading safety alert...</Text>
      ) : null}
      {loadError ? (
        <View>
          <Text accessibilityRole="alert" style={styles.error}>
            {loadError}
          </Text>
          <Button title="Retry alert" disabled={busy} onPress={load} />
        </View>
      ) : null}
      {actionError ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {actionError}
        </Text>
      ) : null}
      {success ? (
        <Text accessibilityRole="alert" style={styles.body}>
          {success}
        </Text>
      ) : null}
      {alert && verified ? (
        <>
          <SectionCard title={alert.title}>
            <Text style={styles.body}>Category: {safetyLabel(alert.type)}</Text>
            <Text style={styles.body}>
              Severity: {safetyLabel(alert.severity)}
            </Text>
            <Text style={styles.body}>Status: {safetyLabel(alert.status)}</Text>
            {alert.description ? (
              <Text style={styles.body}>{alert.description}</Text>
            ) : null}
            <Text style={styles.body}>
              Officer:{' '}
              {alert.assignedTo?.fullName || 'Unassigned or unavailable'}
            </Text>
            <Text style={styles.muted}>
              Created: {safetyTime(alert.createdAt)}
            </Text>
            <Text style={styles.muted}>
              Updated: {safetyTime(alert.updatedAt)}
            </Text>
            {alert.resolvedAt ? (
              <Text style={styles.body}>
                Resolved: {safetyTime(alert.resolvedAt)}
              </Text>
            ) : null}
            {alert.severity === 'critical' ? (
              <Text style={styles.muted}>
                Critical severity. Escalation raises severity and moves an
                active alert to in progress.
              </Text>
            ) : null}
            <Text style={styles.muted}>
              No affected-record reference is available for this alert.
            </Text>
          </SectionCard>
          <SectionCard title="Alert history">
            {!alert.history?.length ? (
              <Text style={styles.muted}>No actions recorded.</Text>
            ) : (
              alert.history.map((entry, index) => (
                <Text
                  key={entry._id || `${entry.createdAt}-${index}`}
                  style={styles.body}
                >
                  {safetyLabel(entry.action)} ·{' '}
                  {entry.performer?.fullName || 'Unavailable user'}
                  {entry.assignedOfficer
                    ? ` → ${entry.assignedOfficer.fullName}`
                    : ''}{' '}
                  · {safetyTime(entry.createdAt)}
                </Text>
              ))
            )}
          </SectionCard>
          {assigning ? (
            <SectionCard title="Assign officer">
              {officersLoading ? (
                <Text style={styles.muted}>Loading eligible officers...</Text>
              ) : officersError ? (
                <View>
                  <Text accessibilityRole="alert" style={styles.error}>
                    {officersError}
                  </Text>
                  <Button
                    title="Retry officers"
                    disabled={busy}
                    onPress={fetchOfficers}
                  />
                </View>
              ) : !officers.length ? (
                <Text style={styles.muted}>
                  No eligible officers are available.
                </Text>
              ) : (
                officers.map(officer => (
                  <Button
                    key={officer._id}
                    title={`Select ${officer.fullName} (${safetyLabel(
                      officer.role,
                    )})`}
                    variant={selected === officer._id ? 'primary' : 'secondary'}
                    disabled={busy}
                    onPress={() => setSelected(officer._id)}
                  />
                ))
              )}
              {selected ? (
                <Text style={styles.body}>
                  Selected:{' '}
                  {officers.find(officer => officer._id === selected)?.fullName}
                </Text>
              ) : null}
              <Button
                title={busy ? 'Assigning...' : 'Confirm officer'}
                disabled={
                  busy ||
                  officersLoading ||
                  !selected ||
                  !actions.includes('assign')
                }
                onPress={() => submit('assign')}
              />
              <Button
                title="Cancel assignment"
                variant="secondary"
                disabled={busy}
                onPress={() => {
                  ++officerGeneration.current;
                  setAssigning(false);
                  setSelected('');
                  setOfficers([]);
                }}
              />
            </SectionCard>
          ) : reviewing ? (
            <SectionCard title="Review resolution">
              <Text style={styles.body}>
                Review the alert and history above. Mark resolved finalizes this
                alert. The system has no separate submitted resolution or
                approval step.
              </Text>
              <Button
                title="Mark resolved"
                disabled={busy || !actions.includes('resolve')}
                onPress={() => submit('resolve')}
              />
              <Button
                title="Cancel review"
                variant="secondary"
                disabled={busy}
                onPress={() => setReviewing(false)}
              />
            </SectionCard>
          ) : (
            <View style={styles.actions}>
              {actions.includes('assign') ? (
                <Button
                  title="Assign officer"
                  disabled={busy}
                  onPress={fetchOfficers}
                />
              ) : null}
              {actions.includes('resolve') ? (
                <Button
                  title="Review resolution"
                  disabled={busy}
                  onPress={() => setReviewing(true)}
                />
              ) : null}
              {actions.includes('escalate') ? (
                <Button
                  title="Escalate"
                  disabled={busy}
                  onPress={() => submit('escalate')}
                />
              ) : null}
            </View>
          )}
        </>
      ) : null}
    </DashboardShell>
  );
}
