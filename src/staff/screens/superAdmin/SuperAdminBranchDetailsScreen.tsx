import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { RouteProp, useRoute } from '@react-navigation/native';

import { useAuth } from '../../context/AuthContext';
import { adminService, branch } from '../../services/admin/adminService';
import { SuperAdminStackParamList } from '../../navigation/SuperAdminNavigator';

type BranchDetailsRouteProp = RouteProp<
  SuperAdminStackParamList,
  'SuperAdminBranchDetails'
>;

const formatTimestamp = (timestamp?: string): string | null => {
  if (!timestamp) return null;

  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleString();
};

const SuperAdminBranchDetailsScreen = () => {
  const { accessToken } = useAuth();
  const route = useRoute<BranchDetailsRouteProp>();

  const { branchId } = route.params;

  const [branch, setBranch] = useState<branch | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadBranch = useCallback(async () => {
    if (!accessToken) {
      setError('Authentication token is missing');
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError('');

      const response = await adminService.getBranchById(
        accessToken,
        branchId,
      );

      setBranch(response.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load branch');
    } finally {
      setLoading(false);
    }
  }, [accessToken, branchId]);

  useEffect(() => {
    loadBranch();
  }, [loadBranch]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
        <Text style={styles.message}>Loading branch...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{error}</Text>
        <TouchableOpacity style={styles.retryButton} onPress={loadBranch}>
          <Text style={styles.retryButtonText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!branch) {
    return (
      <View style={styles.center}>
        <Text style={styles.message}>Branch not found.</Text>
      </View>
    );
  }

  const historyEntries = [
    { label: 'Record created', value: formatTimestamp(branch.createdAt) },
    { label: 'Last updated', value: formatTimestamp(branch.updatedAt) },
  ].filter(
    (entry): entry is { label: string; value: string } => entry.value !== null,
  );

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{branch.name}</Text>

      <View style={styles.card}>
        <Text style={styles.label}>Code</Text>
        <Text style={styles.value}>{branch.code}</Text>

        <Text style={styles.label}>City</Text>
        <Text style={styles.value}>{branch.city}</Text>

        <Text style={styles.label}>Address</Text>
        <Text style={styles.value}>{branch.address}</Text>

        <Text style={styles.label}>Phone</Text>
        <Text style={styles.value}>{branch.phone || 'Not provided'}</Text>

        <Text style={styles.label}>Email</Text>
        <Text style={styles.value}>{branch.email || 'Not provided'}</Text>

        <Text style={styles.label}>Status</Text>
        <Text style={styles.value}>
          {branch.isActive ? 'Active' : 'Inactive'}
        </Text>
      </View>

      <View style={styles.historySection}>
        <Text style={styles.sectionTitle}>Related History</Text>
        {historyEntries.length === 0 ? (
          <Text style={styles.message}>
            No historical timestamps are available for this branch.
          </Text>
        ) : (
          historyEntries.map(entry => (
            <View key={entry.label} style={styles.historyEntry}>
              <Text style={styles.label}>{entry.label}</Text>
              <Text style={styles.value}>{entry.value}</Text>
            </View>
          ))
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 20,
  },
  card: {
    padding: 18,
    borderRadius: 10,
    backgroundColor: '#f5f5f5',
  },
  historySection: {
    marginTop: 24,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 8,
  },
  historyEntry: {
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#d0d0d0',
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    marginTop: 12,
  },
  value: {
    fontSize: 16,
    marginTop: 4,
  },
  message: {
    marginTop: 10,
    fontSize: 16,
  },
  error: {
    fontSize: 16,
    textAlign: 'center',
    color: '#d32f2f',
  },
  retryButton: {
    marginTop: 16,
    backgroundColor: '#0066cc',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
  },
  retryButtonText: {
    color: '#ffffff',
    fontWeight: '600',
    fontSize: 14,
  },
});

export default SuperAdminBranchDetailsScreen;
