import React from 'react';
import { Text } from 'react-native';
import { Card, StatusBadge } from '../../components/hiraDashboard';
import { formStyles } from '../../components/hiraDashboard/AdminForm';
import type { AmendmentHistory } from '../../services/teacher/amendmentService';
export const reviewStateLabel = (state: string) =>
  state.charAt(0).toUpperCase() + state.slice(1);
export function AmendmentHistoryCard({ item }: { item: AmendmentHistory }) {
  return (
    <Card>
      <StatusBadge
        status={
          item.state === 'approved'
            ? 'paid'
            : item.state === 'pending'
            ? 'pending'
            : 'unpaid'
        }
        label={reviewStateLabel(item.state)}
      />
      <Text style={formStyles.label}>
        {item.requestedStatus
          ? `Requested: ${item.requestedStatus}`
          : `Leave: ${item.fromDate} to ${item.untilDate}`}
      </Text>
      {item.originalStatus ? (
        <Text style={formStyles.copy}>
          Original submission: {item.originalStatus} · Current when requested:{' '}
          {item.baseStatus}
        </Text>
      ) : null}
      <Text style={formStyles.copy}>{item.reason}</Text>
      <Text style={formStyles.helper}>
        Requested by {item.requestedBy} ·{' '}
        {new Date(item.requestedAt).toLocaleString()}
      </Text>
      {item.reviewedBy ? (
        <Text style={formStyles.helper}>
          Reviewed by {item.reviewedBy} ·{' '}
          {item.reviewedAt ? new Date(item.reviewedAt).toLocaleString() : ''}
        </Text>
      ) : null}
      {item.reviewNote ? (
        <Text style={formStyles.copy}>Review note: {item.reviewNote}</Text>
      ) : null}
    </Card>
  );
}
