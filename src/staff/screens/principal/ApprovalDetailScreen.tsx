import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, StyleSheet, Text, TextInput, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import {
  Button,
  Card,
  ListRow,
  ScreenHeading,
  SectionCard,
} from '../../components/hiraDashboard';
import { DashboardShell } from '../../components/hiraDashboard/DashboardShell';
import { useAuth } from '../../context/AuthContext';
import {
  ApprovalAction,
  principalService,
} from '../../services/principal/principalService';
import { colors, typography } from '../../theme/hiraDashboard';
import type { PrincipalStackParamList } from '../../navigation/PrincipalNavigator';

import ApprovalDelegationForm from './ApprovalDelegationForm';
import PrincipalLessonReviewScreen from './PrincipalLessonReviewScreen';

type Props = NativeStackScreenProps<PrincipalStackParamList, 'ApprovalDetail'>;

const actionLabels: Record<ApprovalAction, string> = {
  approved: 'Approve',
  rejected: 'Reject',
  changes_requested: 'Request changes',
};

const reviewApprovalNote =
  'Review approved. This records the approval decision; any related business action is handled separately.';

const requesterName = (value: string | { fullName: string }): string =>
  typeof value === 'string' ? value : value.fullName;

const prettyValue = (value: string): string =>
  value === 'changes_requested'
    ? 'Changes requested'
    : value.replaceAll('_', ' ').replace(/^./, first => first.toUpperCase());

export default function ApprovalDetailScreen(props: Props) {
  return props.route.params.request.entityType === 'lesson_plan'
    ? <PrincipalLessonReviewScreen key={props.route.params.request._id} {...props} />
    : <GenericApprovalDetail {...props} />;
}
function GenericApprovalDetail({ route, navigation }: Props) {
  const { accessToken } = useAuth();
  const [loadedRequest, setLoadedRequest] = useState(route.params.request);
  const [detailError, setDetailError] = useState<string | null>(null);
  const request = loadedRequest;
  const [detailVerified, setDetailVerified] = useState(false);
  const [delegating, setDelegating] = useState(false);
  const [delegationBusy, setDelegationBusy] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const decisionLock = useRef(false);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [stillPending, setStillPending] = useState(
    request.status === 'pending',
  );

  const loadRequest = useCallback(async () => {
    if (!accessToken) return;
    setDetailError(null);
    setDetailVerified(false);
    try {
      const response = await principalService.getApprovalById(
        accessToken,
        route.params.request._id,
      );
      setLoadedRequest(response.data);
      if (response.data.capabilities?.canDelegate === false) {
        setDelegating(false);
      }
      setDetailVerified(true);
      setStillPending(response.data.status === 'pending');
    } catch (requestError: unknown) {
      setDetailError(
        requestError instanceof Error
          ? requestError.message
          : 'Unable to refresh approval details.',
      );
    }
  }, [accessToken, route.params.request._id]);

  useEffect(() => {
    loadRequest().catch(() => undefined);
  }, [loadRequest]);
  const submit = async (action: ApprovalAction) => {
    if (action !== 'approved' && !reason.trim()) {
      setActionError('Enter a reason before submitting this decision.');
      return;
    }
    if (
      !accessToken ||
      decisionLock.current ||
      delegating ||
      delegationBusy ||
      !stillPending ||
      !detailVerified ||
      !request.capabilities?.canReview
    )
      return;
    decisionLock.current = true;

    setSubmitting(true);
    setActionError(null);
    try {
      const latest = await principalService.getPendingApprovals(accessToken);
      const current = latest.data.requests.find(
        item => item._id === request._id,
      );
      if (!current || current.status !== 'pending') {
        setStillPending(false);
        await loadRequest();
        setActionError(
          'This request is no longer pending. The inbox has been updated.',
        );
        return;
      }

      const result = await principalService.processApproval(
        accessToken,
        request._id,
        action,
        reason.trim() || undefined,
      );
      setLoadedRequest(result.data);
      setStillPending(false);
      Alert.alert(
        actionLabels[action],
        action === 'approved'
          ? `${result.message}\n\n${reviewApprovalNote}`
          : result.message,
        [{ text: 'Done', onPress: () => navigation.goBack() }],
      );
    } catch (requestError: unknown) {
      const message =
        requestError instanceof Error
          ? requestError.message
          : 'Unable to submit the decision.';
      setActionError(message);
      await loadRequest();
    } finally {
      decisionLock.current = false;
      setSubmitting(false);
    }
  };

  return (
    <DashboardShell>
      <Button
        title="Back to approvals"
        disabled={submitting || delegationBusy}
        variant="secondary"
        onPress={() => navigation.goBack()}
        style={styles.backButton}
      />
      <ScreenHeading title="Approval request" subtitle={request.entityType} />
      <Button
        title="Refresh approval details"
        variant="secondary"
        disabled={submitting || delegationBusy}
        onPress={loadRequest}
      />
      {detailError ? (
        <Card>
          <Text accessibilityRole="alert" style={styles.error}>
            {detailError}
          </Text>
          <Button
            title="Retry details"
            variant="secondary"
            onPress={() => {
              loadRequest().catch(() => undefined);
            }}
          />
        </Card>
      ) : null}
      <SectionCard
        title={`${prettyValue(request.approvalType)} · ${requesterName(
          request.requesterId,
        )}`}
      >
        <InfoRow label="Requester" value={requesterName(request.requesterId)} />
        <InfoRow
          label="Request type"
          value={prettyValue(request.approvalType)}
        />
        <InfoRow label="Subject" value={request.entityType} />
        {request.entityId ? (
          <InfoRow label="Record ID" value={request.entityId} />
        ) : null}
        {request.amount !== undefined ? (
          <InfoRow
            label="Amount"
            value={request.amount.toLocaleString('en-PK')}
          />
        ) : null}
        <InfoRow label="Reason" value={request.reason} />
        {request.staffLeave ? <>
          <InfoRow label="Leave type" value={request.staffLeave.leaveType} />
          <InfoRow label="Leave dates" value={`${request.staffLeave.startDate} to ${request.staffLeave.endDate}`} />
          <InfoRow label="Calendar days requested" value={String(request.staffLeave.days)} />
        </> : null}
      </SectionCard>
      <SectionCard title="Review status">
        <InfoRow label="Status" value={prettyValue(request.status)} />
        {request.status === 'approved' ? (
          <Text style={styles.muted}>{reviewApprovalNote}</Text>
        ) : null}
        {request.delegatedTo ? (
          <InfoRow
            label="Delegated to"
            value={requesterName(request.delegatedTo)}
          />
        ) : null}
        {request.delegatedBy ? (
          <InfoRow
            label="Delegated by"
            value={requesterName(request.delegatedBy)}
          />
        ) : null}
        {request.delegationExpiresAt ? (
          <InfoRow
            label="Delegation expires"
            value={new Date(request.delegationExpiresAt).toLocaleString()}
          />
        ) : null}
      </SectionCard>
      {success ? (
        <Text accessibilityRole="alert" style={styles.muted}>
          {success}
        </Text>
      ) : null}
      {actionError ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {actionError}
        </Text>
      ) : null}
      <SectionCard title="Decision history">
        {request.history.length === 0 ? (
          <Text style={styles.muted}>
            No decisions have been recorded for this request.
          </Text>
        ) : (
          request.history.map((entry, index) => (
            <ListRow
              key={entry._id || `${entry.createdAt}-${entry.action}-${index}`}
              icon="◷"
              title={prettyValue(entry.action)}
              subtitle={[
                typeof entry.performedBy === 'string'
                  ? entry.performedBy
                  : entry.performedBy.fullName,
                new Date(entry.createdAt).toLocaleString(),
                entry.authority ? `Authority: ${entry.authority}` : undefined,
                entry.delegatedBy
                  ? `Delegated by ${requesterName(entry.delegatedBy)}`
                  : undefined,
                entry.reason,
              ]
                .filter(Boolean)
                .join(' · ')}
              last={index === request.history.length - 1}
            />
          ))
        )}
      </SectionCard>
      {delegating &&
      detailVerified &&
      request.capabilities?.canDelegate &&
      accessToken ? (
        <ApprovalDelegationForm
          token={accessToken}
          requestId={request._id}
          onBusyChange={setDelegationBusy}
          onCancel={() => setDelegating(false)}
          onFailure={message => {
            setActionError(message);
            loadRequest().catch(() => undefined);
          }}
          onSuccess={(updated, message) => {
            setLoadedRequest(updated);
            setStillPending(updated.status === 'pending');
            setDelegating(false);
            setActionError(null);
            setSuccess(message);
            loadRequest().catch(() => undefined);
          }}
        />
      ) : null}
      {stillPending && detailVerified && request.capabilities?.canReview ? (
        <SectionCard title="Your decision">
          <Text style={styles.fieldLabel}>
            Reason for rejection or requested changes
          </Text>
          <TextInput
            value={reason}
            onChangeText={setReason}
            multiline
            accessibilityLabel="Decision reason"
            placeholder="Required for Reject and Request changes"
            placeholderTextColor={colors.muted}
            style={styles.reasonInput}
          />
          <View style={styles.actions}>
            {request.capabilities?.canDelegate && !delegating ? (
              <Button
                title="Delegate"
                variant="secondary"
                disabled={submitting || delegationBusy}
                onPress={() => {
                  if (decisionLock.current) return;
                  setDelegating(true);
                  setSuccess(null);
                  setActionError(null);
                }}
              />
            ) : null}
            <Button
              title="Approve"
              onPress={() => submit('approved')}
              disabled={submitting || delegationBusy || delegating}
              style={styles.actionButton}
            />
            <Button
              title="Reject"
              variant="danger"
              onPress={() => submit('rejected')}
              disabled={
                submitting || delegationBusy || delegating || !reason.trim()
              }
              style={styles.actionButton}
            />
            <Button
              title="Request changes"
              variant="secondary"
              onPress={() => submit('changes_requested')}
              disabled={
                submitting || delegationBusy || delegating || !reason.trim()
              }
              style={styles.actionButton}
            />
          </View>
          {submitting ? (
            <Text style={styles.muted}>Rechecking request status…</Text>
          ) : null}
        </SectionCard>
      ) : (
        <Card>
          <Button
            title="Refresh details"
            variant="secondary"
            disabled={submitting || delegationBusy}
            onPress={loadRequest}
          />
          <Text style={styles.muted}>
            {request.status === 'changes_requested'
              ? 'Awaiting correction and resubmission by the original requester.'
              : 'This request is not currently available for review.'}
          </Text>
        </Card>
      )}
    </DashboardShell>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  backButton: { alignSelf: 'flex-start', marginBottom: 16 },
  infoRow: {
    gap: 4,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  fieldLabel: { ...typography.caption, color: colors.muted },
  infoValue: { ...typography.body, color: colors.ink },
  reasonInput: {
    minHeight: 94,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 12,
    marginTop: 8,
    color: colors.ink,
    textAlignVertical: 'top',
    backgroundColor: colors.cardWarm,
  },
  actions: { gap: 10, marginTop: 14 },
  actionButton: { width: '100%' },
  error: { ...typography.small, color: colors.danger.text, marginTop: 10 },
  muted: { ...typography.small, color: colors.muted },
});
