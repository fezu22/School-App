import React, { useEffect, useRef, useState } from 'react';
import {
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { theme as t } from '../../theme/hiraTheme';
import PageIcon from '../../shared/components/PageIcon';
import ParentApplicationsPage from './ParentApplicationsPage';
import {
  Action,
  ChildSelector,
  Hero,
  PreviewNote,
  State,
  rows,
  u,
  useParentChildren,
} from './ParentWorkspaceUI';

// Only a trusted, child-scoped provider may supply transport records.
// This UI does not infer a child's position from a phone's location.
export function validPosition(position) {
  return Boolean(
    position &&
      typeof position.latitude === 'number' &&
      typeof position.longitude === 'number' &&
      Number.isFinite(position.latitude) &&
      Number.isFinite(position.longitude) &&
      Math.abs(position.latitude) <= 90 &&
      Math.abs(position.longitude) <= 180 &&
      Number.isFinite(Date.parse(position.updatedAt)),
  );
}
export function positionFresh(position, now = Date.now()) {
  const age = now - Date.parse(position?.updatedAt);
  return validPosition(position) && age >= -30000 && age <= 5 * 60 * 1000;
}
export default function ParentTransportPage({
  page,
  previewOnly = false,
  initialChildId = '',
  onChildChange,
  onNavigate,
  provider,
}) {
  const model = useParentChildren(previewOnly, initialChildId, onChildChange);
  const [result, setResult] = useState(null),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(''),
    [revision, setRevision] = useState(0),
    [now, setNow] = useState(Date.now());
  const generation = useRef(0);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const request = ++generation.current;
    setResult(null);
    setError('');
    setLoading(false);
    if (!model.selectedId || page === 'Pickup & Early Exit') return undefined;
    if (model.preview) {
      setResult({
        childId: model.selectedId,
        data: {
          trip: {
            status: 'Sample trip',
            vehicleLabel: 'Bus 07 · design preview',
          },
          records: [
            {
              id: 'PREVIEW-TRIP',
              title:
                page === 'Transport & Alerts'
                  ? 'Sample route update'
                  : 'Sample boarding event',
              body: 'Fictional transport record for UI preview only.',
            },
          ],
        },
      });
      return undefined;
    }
    if (!provider?.load) return undefined;
    setLoading(true);
    Promise.resolve()
      .then(() =>
        provider.load({
          childId: model.selectedId,
          Child: model.selectedId,
          page,
        }),
      )
      .then(data => {
        if (request === generation.current)
          setResult({ childId: model.selectedId, data });
      })
      .catch(failure => {
        if (request === generation.current)
          setError(failure.message || 'Transport records could not load.');
      })
      .finally(() => {
        if (request === generation.current) setLoading(false);
      });
    return () => {
      generation.current += 1;
    };
  }, [model.selectedId, model.preview, page, provider, revision]);
  if (page === 'Pickup & Early Exit')
    return (
      <View style={u.flex}>
        <View style={u.horizontalPadding}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to Home"
            onPress={() => onNavigate('Home')}
            style={u.back}
          >
            <Text style={u.link}>‹ Back to Home</Text>
          </Pressable>
        </View>
        <ParentApplicationsPage
          previewOnly={previewOnly}
          initialChildId={initialChildId}
          onChildChange={onChildChange}
          pickup
        />
      </View>
    );
  const data = result?.childId === model.selectedId ? result.data : null;
  const position = data?.position;
  const entries = rows(data?.records);
  const fresh = positionFresh(position, now);
  const openMap = async () => {
    if (!validPosition(position)) return;
    try {
      await Linking.openURL(
        `https://www.google.com/maps/search/?api=1&query=${position.latitude},${position.longitude}`,
      );
    } catch {
      setError('The map could not open on this device.');
    }
  };
  return (
    <ScrollView
      contentContainerStyle={u.page}
      refreshControl={
        <RefreshControl
          refreshing={model.loading || loading}
          onRefresh={() => {
            model.refresh();
            setRevision(value => value + 1);
          }}
          tintColor={t.primary}
        />
      }
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back to Home"
        onPress={() => onNavigate('Home')}
        style={u.back}
      >
        <Text style={u.link}>‹ Back to Home</Text>
      </Pressable>
      <PreviewNote visible={model.preview} />
      {model.loading ? (
        <State loading title="Loading your children…" />
      ) : model.error ? (
        <State
          error
          title="Unable to load children"
          detail={model.error}
          onRetry={model.refresh}
        />
      ) : !model.children.length ? (
        <State
          title="No linked children yet"
          detail="Your school must verify your child link before transport records can open."
        />
      ) : (
        <>
          <ChildSelector model={model} />
          <Hero
            title={
              page === 'Travel History'
                ? 'Every journey, together'
                : page === 'Transport & Alerts'
                ? 'Updates for a calmer journey'
                : 'A little peace of mind'
            }
            subtitle={
              page === 'Travel History'
                ? 'Confirmed boarding and drop-off history'
                : page === 'Transport & Alerts'
                ? 'Your child’s transport notices'
                : 'Your child’s confirmed school and bus events'
            }
            icon="bus"
          />
          {loading ? (
            <State loading title="Checking transport records…" />
          ) : error ? (
            <State
              error
              title="Could not load transport"
              detail={error}
              onRetry={() => setRevision(value => value + 1)}
            />
          ) : !provider?.load && !model.preview ? (
            <State
              title="School transport is not connected yet"
              detail="Live bus location, travel history and alerts will appear when your school connects transport. You can send an early pickup application from Pickup."
            />
          ) : (
            <>
              {page === 'Track My Child' && (
                <View style={u.card}>
                  <View style={u.row}>
                    <PageIcon name="bus" size={36} color={t.primary} />
                    <View style={u.flex}>
                      <Text style={u.cardTitle}>
                        {data?.trip?.status || 'No active trip reported'}
                      </Text>
                      <Text style={u.muted}>
                        {data?.trip?.vehicleLabel || 'Vehicle not recorded'}
                      </Text>
                    </View>
                  </View>
                  {validPosition(position) ? (
                    <>
                      <Text style={u.label}>
                        {fresh
                          ? 'Recent bus location'
                          : 'Last known bus location · not live'}
                      </Text>
                      <Text style={u.muted}>
                        Updated {new Date(position.updatedAt).toLocaleString()}
                      </Text>
                      <Text style={u.muted}>
                        Bus location, not a live child location.
                      </Text>
                      <Action
                        title="Open bus location in Maps"
                        secondary
                        onPress={openMap}
                      />
                    </>
                  ) : (
                    <Text style={u.muted}>
                      No verified bus GPS position is available.
                    </Text>
                  )}
                  {fresh && data?.trip?.estimatedArrival && (
                    <Text style={u.body}>
                      Estimated arrival: {data.trip.estimatedArrival}
                    </Text>
                  )}
                </View>
              )}
              {entries.length ? (
                entries.map((item, index) => (
                  <View key={item.id || item._id || index} style={u.card}>
                    <Text style={u.cardTitle}>
                      {item.title || item.status || 'Transport update'}
                    </Text>
                    {!!(item.body || item.message) && (
                      <Text style={u.body}>{item.body || item.message}</Text>
                    )}
                    {!!item.occurredAt && (
                      <Text style={u.muted}>
                        {new Date(item.occurredAt).toLocaleString()}
                      </Text>
                    )}
                  </View>
                ))
              ) : (
                <State
                  title={
                    page === 'Travel History'
                      ? 'No journeys recorded'
                      : page === 'Transport & Alerts'
                      ? 'No transport alerts'
                      : 'No confirmed events yet'
                  }
                  detail="Pull down to check for updates."
                />
              )}
            </>
          )}
        </>
      )}
    </ScrollView>
  );
}
