import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button, SectionCard } from '../../components/hiraDashboard';
import { ApiError } from '../../services/api/apiClient';
import {
  ApprovalRequest,
  EligibleDelegate,
  principalService,
} from '../../services/principal/principalService';
import { colors, typography } from '../../theme/hiraDashboard';

const expiryChoices = [
  { label: '1 hour', hours: 1 },
  { label: '4 hours', hours: 4 },
  { label: '24 hours', hours: 24 },
  { label: '7 days', hours: 168 },
];

export function delegationError(error: unknown): string {
  const message =
    error instanceof Error ? error.message : 'Network request failed.';
  if (error instanceof ApiError) {
    const guidance: Record<number, string> = {
      400: 'Check the delegate and choose a future expiry.',
      403: 'Reviewer or delegate authority may have changed. Refresh details and candidates.',
      404: 'The request or delegate is no longer available. Refresh details and candidates.',
      409: 'The request changed. Refresh its details before trying again.',
    };
    return `${message} (${error.status}) ${
      guidance[error.status] || ''
    }`.trim();
  }
  return `${message} Refresh details and candidates before retrying; the server may have received the request.`;
}

interface Props {
  token: string;
  requestId: string;
  onSuccess: (request: ApprovalRequest, message: string) => void;
  onFailure: (message: string) => void;
  onCancel: () => void;
  onBusyChange: (busy: boolean) => void;
}

export default function ApprovalDelegationForm({
  token,
  requestId,
  onSuccess,
  onFailure,
  onCancel,
  onBusyChange,
}: Props) {
  const [candidates, setCandidates] = useState<EligibleDelegate[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<EligibleDelegate | null>(null);
  const [expiry, setExpiry] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const submitLock = useRef(false);
  const loadGeneration = useRef(0);

  const load = useCallback(async () => {
    const generation = ++loadGeneration.current;
    setLoading(true);
    setError(null);
    setSelected(null);
    setCandidates([]);
    try {
      const result = await principalService.getEligibleDelegates(
        token,
        requestId,
      );
      if (generation !== loadGeneration.current) return;
      setCandidates(result.data);
      setNeedsRefresh(false);
    } catch (loadError) {
      if (generation !== loadGeneration.current) return;
      setError(delegationError(loadError));
      setNeedsRefresh(true);
    } finally {
      if (generation === loadGeneration.current) setLoading(false);
    }
  }, [token, requestId]);

  const cancelLoads = useCallback(() => {
    ++loadGeneration.current;
  }, []);

  useEffect(() => {
    load().catch(() => undefined);
    return cancelLoads;
  }, [load, cancelLoads]);

  const submit = async () => {
    if (submitLock.current || loading || needsRefresh) return;
    if (
      !selected ||
      !candidates.some(candidate => candidate._id === selected._id)
    ) {
      setError('Choose an eligible Principal.');
      return;
    }
    if (!expiry || new Date(expiry).getTime() <= Date.now()) {
      setError('Choose a future delegation expiry.');
      return;
    }
    submitLock.current = true;
    setSubmitting(true);
    onBusyChange(true);
    setError(null);
    try {
      const result = await principalService.processApproval(
        token,
        requestId,
        'delegated',
        undefined,
        {
          delegatedTo: selected._id,
          delegationExpiresAt: expiry,
        },
      );
      onSuccess(result.data, result.message);
    } catch (submitError) {
      const message = delegationError(submitError);
      setError(message);
      setNeedsRefresh(true);
      onFailure(message);
    } finally {
      submitLock.current = false;
      setSubmitting(false);
      onBusyChange(false);
    }
  };

  return (
    <SectionCard title="Delegate approval">
      <Text style={styles.label}>Choose an eligible Principal</Text>
      {loading ? (
        <Text style={styles.muted}>Loading eligible Principals...</Text>
      ) : null}
      {!loading && !error && candidates.length === 0 ? (
        <Text style={styles.muted}>
          No eligible Principals are available for this request.
        </Text>
      ) : null}
      <View style={styles.choices}>
        {candidates.map(candidate => (
          <Button
            key={candidate._id}
            title={candidate.fullName}
            variant={selected?._id === candidate._id ? 'primary' : 'secondary'}
            disabled={submitting || loading || needsRefresh}
            onPress={() => setSelected(candidate)}
          />
        ))}
      </View>
      {selected ? (
        <Text style={styles.label}>
          Selected Principal: {selected.fullName}
        </Text>
      ) : null}
      <Text style={styles.label}>Delegation expiry (required)</Text>
      <View style={styles.choices}>
        {expiryChoices.map(choice => (
          <Button
            key={choice.hours}
            title={`Expire in ${choice.label}`}
            variant="secondary"
            disabled={submitting}
            onPress={() =>
              setExpiry(
                new Date(Date.now() + choice.hours * 3600000).toISOString(),
              )
            }
          />
        ))}
      </View>
      {expiry ? (
        <Text style={styles.label}>
          Expires: {new Date(expiry).toLocaleString()} (device local time){'\n'}
          {expiry} (UTC)
        </Text>
      ) : null}
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
      <View style={styles.choices}>
        <Button
          title={submitting ? 'Delegating...' : 'Confirm delegation'}
          onPress={submit}
          disabled={
            submitting || loading || needsRefresh || candidates.length === 0
          }
        />
        <Button
          title="Refresh candidates"
          variant="secondary"
          disabled={submitting || loading}
          onPress={load}
        />
        <Button
          title="Cancel delegation"
          variant="secondary"
          disabled={submitting}
          onPress={onCancel}
        />
      </View>
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  choices: { gap: 10, marginVertical: 12 },
  label: { ...typography.small, color: colors.ink },
  muted: { ...typography.small, color: colors.muted },
  error: { ...typography.small, color: colors.danger.text, marginVertical: 10 },
});
