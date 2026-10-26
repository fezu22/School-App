import React from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, typography } from '../../theme/hiraDashboard';

interface DashboardShellProps {
  children: React.ReactNode;
  safeArea?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  keyboardShouldPersistTaps?: 'always' | 'never' | 'handled';
}

export function DashboardShell({
  children,
  safeArea = true,
  refreshing = false,
  onRefresh,
  keyboardShouldPersistTaps = 'never',
}: DashboardShellProps) {
  const scroll = (
    <ScrollView
      style={dashboardShellStyles.scroll}
      contentContainerStyle={dashboardShellStyles.content}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps={keyboardShouldPersistTaps}
      refreshControl={
        onRefresh ? (
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        ) : undefined
      }
    >
      {children}
    </ScrollView>
  );

  if (!safeArea) return scroll;
  return (
    <SafeAreaView
      edges={['top', 'bottom', 'left', 'right']}
      style={dashboardShellStyles.safeArea}
    >
      {scroll}
    </SafeAreaView>
  );
}

export function DashboardStateCard({
  loading,
  error,
  onRetry,
}: {
  loading: boolean;
  error: string | null;
  onRetry: () => Promise<void>;
}) {
  if (!loading && !error) return null;
  return (
    <View style={dashboardShellStyles.stateCard}>
      {loading ? (
        <ActivityIndicator color={colors.primary} />
      ) : (
        <Text style={dashboardShellStyles.error}>{error}</Text>
      )}
      {loading ? (
        <Text style={dashboardShellStyles.copy}>
          Loading your school overview…
        </Text>
      ) : (
        <Text
          accessibilityRole="button"
          onPress={onRetry}
          style={dashboardShellStyles.retry}
        >
          Tap to try again
        </Text>
      )}
    </View>
  );
}

export const dashboardShellStyles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  scroll: { flex: 1, backgroundColor: colors.background },
  content: { padding: 18, paddingTop: 14, paddingBottom: 32 },
  stateCard: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 17,
    padding: 18,
    marginBottom: 18,
    alignItems: 'center',
    gap: 10,
  },
  error: { ...typography.body, color: colors.ink, textAlign: 'center' },
  copy: { ...typography.small, color: colors.muted },
  retry: { ...typography.button, color: colors.primary },
});
