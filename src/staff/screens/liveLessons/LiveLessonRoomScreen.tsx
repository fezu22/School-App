/* eslint-disable no-void -- Event handlers detach controller operations that report sanitized errors. */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  useNavigation,
  usePreventRemove,
  type NavigationProp,
  type ParamListBase,
} from '@react-navigation/native';
import { useAuth } from '../../context/AuthContext';
import { Button, Card, ScreenHeading } from '../../components/hiraDashboard';
import { DashboardShell } from '../../components/hiraDashboard/DashboardShell';
import { colors, typography } from '../../theme/hiraDashboard';
import {
  timetableService,
  type TeacherPeriod,
} from '../../services/teacher/timetableService';
import {
  liveLessonService,
  liveLessonError,
  type PublicRtcConfig,
} from '../../services/liveLessons/liveLessonService';
import {
  LiveRoomController,
  type LessonTarget,
  type LiveRoomState,
} from '../../services/liveLessons/LiveRoomController';
import {
  mediaPermissions,
  canCapture,
  permissionMessage,
  type MediaPermissions,
} from '../../services/liveLessons/mediaPermissions';
import { createLiveLessonClient } from '../../services/liveLessons/rtc/ZegoLiveLessonClient';
import { ZegoVideo } from '../../services/liveLessons/rtc/ZegoVideo';
import {
  initialRtcState,
  type LiveParticipant,
} from '../../services/liveLessons/rtc/types';

const initialRoom: LiveRoomState = {
  pending: false,
  session: null,
  error: null,
  notice: null,
  closed: false,
};
export default function LiveLessonRoomScreen({
  target,
}: {
  target: LessonTarget;
}) {
  const { accessToken, user } = useAuth();
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const identity =
    target.kind === 'teacher'
      ? target.periodId + '/' + target.date
      : target.sessionId;
  const controller = useMemo(
    () =>
      new LiveRoomController(
        target,
        accessToken ?? '',
        createLiveLessonClient(),
      ),
    // Route primitives own a room. Auth changes destroy the previous ownership.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [accessToken, identity, target.kind],
  );
  const [room, setRoom] = useState(initialRoom),
    [rtc, setRtc] = useState(initialRtcState);
  const [period, setPeriod] = useState<TeacherPeriod | null>(null),
    [config, setConfig] = useState<PublicRtcConfig | null>(null);
  const [permissions, setPermissions] = useState<MediaPermissions | null>(null);
  const [previewReady, setPreviewReady] = useState(false),
    [preparing, setPreparing] = useState(false);
  const [previewCaptured, setPreviewCaptured] = useState(false);
  const [metadataLoading, setMetadataLoading] = useState(
    target.kind === 'teacher',
  );
  const [error, setError] = useState<string | null>(null),
    [exiting, setExiting] = useState(false),
    [controlBusy, setControlBusy] = useState(false);
  const teacher = target.kind === 'teacher';
  useEffect(() => {
    let alive = true;
    let mediaOwned = false;
    let classroomOwned = false;
    setRoom(initialRoom);
    setRtc(initialRtcState);
    setPeriod(null);
    setConfig(null);
    setPreviewReady(false);
    setPreviewCaptured(false);
    setPermissions(null);
    setMetadataLoading(teacher);
    setError(null);
    const offRoom = controller.subscribe(value => {
      classroomOwned = !!value.session;
      if (alive) setRoom(value);
    });
    const offRtc = controller.rtc.subscribe(value => {
      mediaOwned =
        value.cameraEnabled ||
        !value.microphoneMuted ||
        mediaOwned ||
        value.connection === 'preparing' ||
        value.connection === 'connecting' ||
        value.connection === 'connected';
      if (alive) {
        setRtc(value);
        if (
          value.connection === 'disconnected' &&
          value.error?.startsWith('Media cleanup')
        )
          Alert.alert('Check device media', value.error);
      }
    });
    const background = AppState.addEventListener('change', state => {
      if (state === 'background' && (mediaOwned || classroomOwned))
        void controller.close(
          'Media was closed when the app moved to the background. Leave and open the lesson again.',
        );
      if (state === 'active' && teacher && !mediaOwned) {
        mediaPermissions
          .check()
          .then(value => {
            if (alive) setPermissions(value);
          })
          .catch(() => {
            if (alive) setError('Device permission could not be verified.');
          });
      }
    });
    if (teacher && accessToken && target.kind === 'teacher') {
      Promise.all([
        timetableService.getPeriod(accessToken, target.periodId, target.date),
        liveLessonService.previewConfig(
          accessToken,
          target.periodId,
          target.date,
        ),
        mediaPermissions.check(),
      ])
        .then(([value, metadata, permission]) => {
          if (alive) {
            setPeriod(value);
            setConfig(metadata);
            setPermissions(permission);
          }
        })
        .catch(cause => {
          if (alive) setError(liveLessonError(cause));
        })
        .finally(() => {
          if (alive) setMetadataLoading(false);
        });
    }
    return () => {
      alive = false;
      offRoom();
      offRtc();
      background.remove();
      void controller.close();
    };
  }, [controller, teacher, accessToken, target]);
  useEffect(() => {
    if (exiting) navigation.goBack();
  }, [exiting, navigation]);
  const leave = useCallback(async () => {
    await controller.close();
    setExiting(true);
  }, [controller]);
  usePreventRemove(!exiting, () => {
    Alert.alert(
      'Leave live lesson?',
      teacher && room.session?.status === 'live'
        ? 'Leaving closes your media. Use End Lesson to end the school session for everyone.'
        : 'Your media connection will be closed.',
      [
        { text: 'Stay', style: 'cancel' },
        {
          text: 'Leave',
          style: 'destructive',
          onPress: () => {
            void leave();
          },
        },
      ],
    );
  });
  const localView = useCallback(
    (view: number) => {
      void controller.rtc
        .preview(view)
        .then(() => setPreviewCaptured(true))
        .catch(() =>
          setError(
            'Camera preview could not start. Leave and check device permissions.',
          ),
        );
    },
    [controller],
  );
  const preparePreview = async () => {
    if (preparing || !config || room.closed) return;
    setPreparing(true);
    setError(null);
    try {
      const permission = await mediaPermissions.request();
      setPermissions(permission);
      if (!canCapture(permission)) return;
      if (config.provider !== 'zegocloud') throw new Error('provider');
      await controller.rtc.prepare(config.appId);
      setPreviewReady(true);
    } catch {
      setError(
        'Media preview is unavailable. Check device permissions and reopen the lesson.',
      );
    } finally {
      setPreparing(false);
    }
  };
  const control = async (action: () => Promise<void>) => {
    if (controlBusy) return;
    setControlBusy(true);
    setError(null);
    try {
      await action();
    } catch {
      setError(
        'The media control could not be applied. Your last confirmed state is shown.',
      );
    } finally {
      setControlBusy(false);
    }
  };
  const end = () =>
    Alert.alert(
      'End Lesson?',
      'This ends the school session and closes your media.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'End Lesson',
          style: 'destructive',
          onPress: async () => {
            if (await controller.end()) setExiting(true);
          },
        },
      ],
    );
  if (!user || (teacher ? user.role !== 'teacher' : user.role !== 'student'))
    return (
      <Text accessibilityRole="alert">
        This live lesson is unavailable for your role.
      </Text>
    );
  const busy = room.pending || preparing || controlBusy;
  return (
    <DashboardShell safeArea={false}>
      <ScreenHeading
        title={teacher ? 'Host live lesson' : 'Live lesson'}
        subtitle={
          period
            ? `${period.className} · ${period.sectionName} · ${period.subjectName}`
            : 'Secure school live classroom'
        }
      />
      <Card>
        {period ? (
          <Text style={styles.body}>
            {period.date} · {period.startTime}–{period.endTime}
          </Text>
        ) : room.session ? (
          <Text style={styles.body}>
            {new Date(room.session.scheduledStart).toLocaleString()}
          </Text>
        ) : null}
        <Text accessibilityLiveRegion="polite" style={styles.body}>
          Media: {rtc.connection}
        </Text>
        <Text style={styles.muted}>
          School session (last verified):{' '}
          {room.session?.status ?? 'not started'}
        </Text>
        {room.reliability ? (
          <Text accessibilityLiveRegion="polite" style={styles.body}>
            Classroom:{' '}
            {room.reliability === 'waiting'
              ? 'Waiting for teacher admission'
              : room.reliability.replace(/_/g, ' ')}
          </Text>
        ) : null}
        <Text accessibilityLiveRegion="polite" style={styles.muted}>
          Connection quality: {rtc.quality}
        </Text>
        {rtc.quality === 'poor' ? (
          <Text style={styles.body}>
            Connection unstable.{' '}
            {teacher
              ? 'Turn off your camera to continue with audio only.'
              : 'Audio may recover before video. Stay in this lesson while reconnecting.'}
          </Text>
        ) : null}
        {teacher && rtc.connection === 'connected' ? (
          <Text style={styles.muted}>
            {rtc.publishing
              ? 'Publishing your lesson'
              : 'Waiting for media publishing confirmation'}
          </Text>
        ) : null}
        {busy || metadataLoading ? (
          <ActivityIndicator accessibilityLabel="Preparing live lesson" />
        ) : null}
        {[error, room.error, rtc.error]
          .filter(Boolean)
          .map((message, index) => (
            <Text key={index} accessibilityRole="alert" style={styles.error}>
              {message}
            </Text>
          ))}
        {room.notice ? (
          <Text accessibilityLiveRegion="polite" style={styles.body}>
            {room.notice}
          </Text>
        ) : null}
      </Card>
      {room.classroom && !room.closed ? (
        <Card>
          {teacher ? (
            <>
              <Text style={styles.heading}>Classroom participants</Text>
              <Text style={styles.body}>
                Waiting:{' '}
                {room.classroom.participants?.filter(
                  p => p.admission === 'waiting',
                ).length ?? 0}
              </Text>
              <Text style={styles.muted}>
                Learners watch and listen; learner microphones and cameras
                cannot publish.
              </Text>
              {room.classroom.participants
                ?.filter(p => p.role === 'participant')
                .map(participant => (
                  <View key={participant.id}>
                    <Text style={styles.body}>
                      {participant.displayName} · {participant.admission} ·{' '}
                      {participant.connectionState}
                      {participant.handRaised ? ' · Hand raised' : ''}
                    </Text>
                    {participant.admission === 'waiting' ? (
                      <>
                        <Button
                          title={`Admit ${participant.displayName}`}
                          disabled={busy}
                          onPress={() => {
                            void controller.moderate(participant.id, 'admit');
                          }}
                        />
                        <Button
                          title={`Reject ${participant.displayName}`}
                          disabled={busy}
                          variant="secondary"
                          onPress={() => {
                            void controller.moderate(participant.id, 'reject');
                          }}
                        />
                      </>
                    ) : null}
                    {participant.admission === 'admitted' ? (
                      <Button
                        title={`Remove ${participant.displayName}`}
                        disabled={busy}
                        variant="danger"
                        onPress={() =>
                          Alert.alert(
                            'Remove participant?',
                            'This blocks rejoining this lesson. Provider disconnect may take time if the service is unavailable.',
                            [
                              { text: 'Cancel', style: 'cancel' },
                              {
                                text: 'Remove',
                                style: 'destructive',
                                onPress: () => {
                                  void controller.moderate(
                                    participant.id,
                                    'remove',
                                  );
                                },
                              },
                            ],
                          )
                        }
                      />
                    ) : null}
                    {participant.handRaised ? (
                      <Button
                        title={`Acknowledge ${participant.displayName}'s hand`}
                        disabled={busy}
                        variant="secondary"
                        onPress={() => {
                          void controller.moderate(
                            participant.id,
                            'lower-hand',
                          );
                        }}
                      />
                    ) : null}
                    {participant.admission === 'removed' ? (
                      <Text style={styles.muted}>
                        School access removed. Media disconnect:{' '}
                        {participant.enforcement === 'confirmed'
                          ? 'provider confirmed'
                          : participant.enforcement === 'expired'
                          ? 'credential expired'
                          : 'pending confirmation'}
                        .
                      </Text>
                    ) : null}
                  </View>
                ))}
            </>
          ) : room.classroom.participant.admission === 'admitted' ? (
            <Button
              title={
                room.classroom.participant.handRaised
                  ? 'Hand raised · Lower hand'
                  : 'Raise hand'
              }
              disabled={busy}
              onPress={() => {
                void controller.hand(!room.classroom!.participant.handRaised);
              }}
            />
          ) : (
            <Text accessibilityLiveRegion="polite" style={styles.body}>
              Your request is {room.classroom.participant.admission}. Camera and
              microphone remain off.
            </Text>
          )}
        </Card>
      ) : null}
      {teacher && !room.closed ? (
        <Card>
          <Text style={styles.heading}>Your camera preview</Text>
          {previewReady ? (
            <View style={styles.video}>
              <ZegoVideo onReady={localView} />
            </View>
          ) : (
            <Text style={styles.muted}>
              Enable camera and microphone access to preview before starting.
            </Text>
          )}
          {permissions ? (
            <>
              <Text style={styles.body}>
                {permissionMessage('Camera', permissions.camera)}
              </Text>
              <Text style={styles.body}>
                {permissionMessage('Microphone', permissions.microphone)}
              </Text>
            </>
          ) : null}
          {!previewReady ? (
            <Button
              title="Enable camera and microphone"
              disabled={
                busy ||
                !config ||
                (!!permissions &&
                  [permissions.camera, permissions.microphone].some(
                    status => status === 'blocked' || status === 'unavailable',
                  ))
              }
              onPress={() => {
                void preparePreview();
              }}
            />
          ) : null}
          {permissions && !canCapture(permissions) ? (
            <Button
              title="Open device settings"
              variant="secondary"
              onPress={() => {
                void mediaPermissions
                  .settings()
                  .catch(() =>
                    setError(
                      'Open your device Settings to enable camera and microphone.',
                    ),
                  );
              }}
            />
          ) : null}
          {previewReady ? (
            <>
              <Button
                title={
                  rtc.microphoneMuted
                    ? 'Microphone muted · Unmute'
                    : 'Microphone on · Mute'
                }
                disabled={busy}
                variant="secondary"
                onPress={() => {
                  void control(() =>
                    controller.rtc.muteMicrophone(!rtc.microphoneMuted),
                  );
                }}
              />
              <Button
                title={
                  rtc.cameraEnabled
                    ? 'Camera on · Turn off'
                    : 'Camera off · Turn on'
                }
                disabled={busy}
                variant="secondary"
                onPress={() => {
                  void control(() =>
                    controller.rtc.enableCamera(!rtc.cameraEnabled),
                  );
                }}
              />
            </>
          ) : null}
        </Card>
      ) : null}
      {rtc.participants.map(participant => (
        <RemoteTile
          key={participant.participantKey}
          participant={participant}
          controller={controller}
        />
      ))}
      {!teacher &&
      rtc.connection === 'connected' &&
      !rtc.participants.length ? (
        <Card>
          <Text style={styles.body}>
            Connected. Waiting for the lesson presenter’s stream.
          </Text>
        </Card>
      ) : null}
      {!teacher ? (
        <Text style={styles.muted}>
          You can watch and listen. Learner camera and microphone publishing are
          disabled.
        </Text>
      ) : null}
      {!room.session && !room.closed ? (
        <Button
          title={teacher ? 'Start Lesson' : 'Join Lesson'}
          disabled={
            busy ||
            rtc.connection === 'error' ||
            rtc.connection === 'disconnected' ||
            (teacher &&
              (!previewCaptured || !permissions || !canCapture(permissions)))
          }
          onPress={() => {
            void (async () => {
              if (teacher) {
                try {
                  const current = await mediaPermissions.check();
                  setPermissions(current);
                  if (!canCapture(current)) {
                    await controller.close(
                      'Camera or microphone permission was revoked. Reopen the lesson after enabling access.',
                    );
                    return;
                  }
                } catch {
                  setError('Device permission could not be verified.');
                  return;
                }
              }
              await controller.enter();
            })();
          }}
        />
      ) : null}
      {teacher && room.session?.status === 'live' && !room.closed ? (
        <Button
          title="End Lesson"
          variant="danger"
          disabled={busy}
          onPress={end}
        />
      ) : null}
      <Button
        title={teacher ? 'Leave screen' : 'Leave Lesson'}
        variant="secondary"
        disabled={room.pending}
        onPress={() => {
          void leave();
        }}
      />
    </DashboardShell>
  );
}
function RemoteTile({
  participant,
  controller,
}: {
  participant: LiveParticipant;
  controller: LiveRoomController;
}) {
  const attach = useCallback(
    (handle: number) => {
      void controller.rtc
        .attachRemote(participant.streamId, handle)
        .catch(() => undefined);
    },
    [controller, participant.streamId],
  );
  return (
    <Card>
      <Text style={styles.heading}>{participant.displayName}</Text>
      <View
        style={[styles.video, !participant.videoActive && styles.hiddenVideo]}
      >
        <ZegoVideo onReady={attach} />
      </View>
      <Text style={styles.body}>
        {participant.videoActive ? 'Video available' : 'Camera off'} ·{' '}
        {participant.audioActive ? 'Audio on' : 'Microphone muted'}
      </Text>
      <Text style={styles.muted}>Media: {participant.mediaState}</Text>
      {participant.mediaState === 'error' ? (
        <Text accessibilityRole="alert" style={styles.error}>
          This lesson stream could not play. Leave and join again.
        </Text>
      ) : null}
    </Card>
  );
}
const styles = StyleSheet.create({
  heading: { ...typography.h3, color: colors.ink },
  body: { ...typography.body, color: colors.ink },
  muted: { ...typography.small, color: colors.muted },
  error: { ...typography.body, color: colors.danger.text },
  video: {
    height: 230,
    backgroundColor: colors.ink,
    borderRadius: 12,
    overflow: 'hidden',
  },
  hiddenVideo: { height: 1, opacity: 0 },
});
