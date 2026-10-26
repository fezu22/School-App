/* eslint-disable no-void -- SDK event callbacks detach operations with local error handling. */
import type Engine from 'zego-express-engine-reactnative';
import type { ZegoEventListener } from 'zego-express-engine-reactnative/lib/ZegoExpressEventHandler';
import type { LiveCredential } from '../liveLessonService';
import {
  initialRtcState,
  RtcFailure,
  type LiveLessonClient,
  type RtcState,
} from './types';
type Sdk = typeof import('zego-express-engine-reactnative');
let owner: ZegoLiveLessonClient | null = null;
export class ZegoLiveLessonClient implements LiveLessonClient {
  private engine?: Engine;
  private sdk?: Sdk;
  private appId?: number;
  private room?: string;
  private identity?: string;
  private role?: LiveCredential['role'];
  private previewStarted = false;
  private closed = false;
  private tail: Promise<unknown> = Promise.resolve();
  private disposal?: Promise<void>;
  private expiry?: () => void;
  private reconnect?: (phase: 'reconnecting' | 'recovered') => void;
  private reconnectDeadline?: ReturnType<typeof setTimeout>;
  private listeners = new Set<(state: RtcState) => void>();
  private state: RtcState = { ...initialRtcState, participants: [] };
  private removers: (() => void)[] = [];
  constructor(
    private readonly load: () => Promise<Sdk> = async () =>
      require('zego-express-engine-reactnative') as Sdk,
  ) {}
  subscribe(listener: (state: RtcState) => void) {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private update(patch: Partial<RtcState>) {
    if (
      this.closed &&
      patch.connection !== 'disconnected' &&
      patch.connection !== 'removed'
    )
      return;
    this.state = { ...this.state, ...patch };
    this.listeners.forEach(listener => listener(this.state));
  }
  private run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(async () => {
      if (this.closed) throw new Error('Live room has closed.');
      return operation();
    });
    this.tail = result.catch(() => undefined);
    return result;
  }
  private listen<K extends keyof ZegoEventListener>(
    event: K,
    handler: ZegoEventListener[K],
  ) {
    this.engine!.on(event, handler);
    this.removers.push(() => this.engine?.off(event, handler));
  }
  private bind() {
    this.listen('networkQuality', (userId, upstream, downstream) => {
      if (userId && userId !== this.identity) return;
      const level = Math.max(Number(upstream), Number(downstream));
      const quality =
        level <= 1
          ? 'good'
          : level === 2
          ? 'fair'
          : level <= 4
          ? 'poor'
          : 'unavailable';
      this.update({
        quality,
        ...(this.state.connection === 'connected' ||
        this.state.connection === 'degraded' ||
        this.state.connection === 'recovered'
          ? { connection: quality === 'poor' ? 'degraded' : 'connected' }
          : {}),
      });
    });
    this.listen('localDeviceExceptionOccurred', () => {
      this.update({
        error:
          'Camera or microphone capture failed. Check device access and reopen the lesson.',
        microphoneMuted: true,
        cameraEnabled: false,
      });
      void this.dispose();
    });
    this.listen('roomStateChanged', (room, reason, error) => {
      if (room !== this.room || this.closed) return;
      const r = this.sdk!.ZegoRoomStateChangedReason;
      if (
        error ||
        reason === r.KickOut ||
        reason === r.ReconnectFailed ||
        reason === r.LoginFailed
      ) {
        this.update({
          connection: reason === r.KickOut ? 'removed' : 'error',
          error:
            'Media connection ended. Leave and join again through the school app.',
        });
        void this.dispose();
      } else if (reason === r.Reconnecting) {
        this.update({ connection: 'reconnecting', quality: 'unavailable' });
        this.reconnect?.('reconnecting');
        if (!this.reconnectDeadline)
          this.reconnectDeadline = setTimeout(() => {
            this.update({
              error: 'Media could not recover. Leave and request access again.',
            });
            void this.dispose();
          }, 30000);
      } else if (reason === r.Reconnected) {
        clearTimeout(this.reconnectDeadline);
        this.reconnectDeadline = undefined;
        this.update({ connection: 'recovered' });
        this.reconnect?.('recovered');
      }
    });
    this.listen('roomTokenWillExpire', room => {
      if (room === this.room && !this.closed) this.expiry?.();
    });
    this.listen('roomStreamUpdate', (room, updateType, streams) => {
      if (room !== this.room || this.closed) return;
      if (updateType === this.sdk!.ZegoUpdateType.Add) {
        const participants = [...this.state.participants];
        streams.forEach(stream => {
          if (
            stream.user.userID === this.identity ||
            participants.some(p => p.streamId === stream.streamID)
          )
            return;
          participants.push({
            participantKey: stream.streamID,
            streamId: stream.streamID,
            displayName: 'Lesson presenter',
            isLocal: false,
            audioActive: true,
            videoActive: true,
            mediaState: 'loading',
          });
          // Audio can begin before the native video surface is mounted.
          void this.run(() =>
            this.engine!.startPlayingStream(
              stream.streamID,
              undefined,
              undefined,
            ),
          ).catch(() => this.mediaError(stream.streamID));
        });
        this.update({ participants });
      } else {
        const ids = streams.map(stream => stream.streamID);
        this.update({
          participants: this.state.participants.filter(
            p => !ids.includes(p.streamId),
          ),
        });
        ids.forEach(id => {
          void this.run(() => this.engine!.stopPlayingStream(id)).catch(
            () => undefined,
          );
        });
      }
    });
    this.listen('playerStateUpdate', (id, state, error) => {
      this.update({
        participants: this.state.participants.map(p =>
          p.streamId === id
            ? {
                ...p,
                mediaState: error
                  ? 'error'
                  : state === this.sdk!.ZegoPlayerState.Playing
                  ? 'playing'
                  : 'loading',
              }
            : p,
        ),
      });
    });
    this.listen('remoteCameraStateUpdate', (id, state) => {
      this.update({
        participants: this.state.participants.map(p =>
          p.streamId === id
            ? {
                ...p,
                videoActive: state === this.sdk!.ZegoRemoteDeviceState.Open,
              }
            : p,
        ),
      });
    });
    this.listen('remoteMicStateUpdate', (id, state) => {
      this.update({
        participants: this.state.participants.map(p =>
          p.streamId === id
            ? {
                ...p,
                audioActive: state === this.sdk!.ZegoRemoteDeviceState.Open,
              }
            : p,
        ),
      });
    });
    this.listen('publisherStateUpdate', (_id, state, error) => {
      this.update({
        publishing: !error && state === this.sdk!.ZegoPublisherState.Publishing,
        ...(error
          ? {
              error:
                'Your media could not be published. Leave and retry the lesson.',
            }
          : {}),
      });
    });
  }
  private mediaError(id: string) {
    this.update({
      participants: this.state.participants.map(p =>
        p.streamId === id ? { ...p, mediaState: 'error' } : p,
      ),
    });
  }
  prepare(appId: number) {
    return this.run(async () => {
      if (this.engine) {
        if (this.appId !== appId)
          throw new Error('Media configuration changed. Leave and retry.');
        return;
      }
      if (owner && owner !== this)
        throw new Error('Another live lesson is already open.');
      if (!Number.isInteger(appId) || appId <= 0)
        throw new Error('Media configuration is unavailable.');
      owner = this; // eslint-disable-line consistent-this -- Native singleton ownership spans screen instances.
      this.update({ connection: 'preparing' });
      try {
        this.sdk = await this.load();
        if (this.closed) return;
        await this.sdk.default.setEngineConfig({
          logConfig: { logPath: '', logSize: 0, logCount: 3 },
        });
        this.engine = await this.sdk.default.createEngineWithProfile({
          appID: appId,
          appSign: '',
          scenario: this.sdk.ZegoScenario.Broadcast,
        });
        this.appId = appId;
        await this.engine.enableCamera(false, undefined);
        await this.engine.muteMicrophone(true);
        this.bind();
        this.update({ connection: 'idle' });
      } catch {
        this.update({
          connection: 'error',
          error:
            'Media initialization failed. Leave this screen and try again.',
        });
        void this.dispose();
        throw new Error(
          'Media initialization failed. Leave this screen and try again.',
        );
      }
    });
  }
  preview(view: number) {
    return this.run(async () => {
      if (!this.engine || this.role === 'participant')
        throw new Error('Camera preview is unavailable.');
      if (!this.previewStarted) await this.engine.enableCamera(true, undefined);
      await this.engine.startPreview(
        {
          reactTag: view,
          viewMode: this.sdk!.ZegoViewMode.AspectFit,
          backgroundColor: 0,
        },
        undefined,
      );
      if (!this.previewStarted) {
        this.previewStarted = true;
        this.update({ cameraEnabled: true });
      }
    });
  }
  connect(input: LiveCredential) {
    return this.run(async () => {
      if (
        !Number.isFinite(Date.parse(input.expiresAt)) ||
        Date.parse(input.expiresAt) <= Date.now()
      )
        throw new RtcFailure(
          'expired',
          'Your live credential has expired. Leave and request access again.',
        );
      if (
        !this.engine ||
        input.provider !== 'zegocloud' ||
        input.appId !== this.appId ||
        !input.roomId ||
        !input.userId ||
        !input.token ||
        Date.parse(input.expiresAt) <= Date.now() ||
        !Number.isFinite(Date.parse(input.expiresAt))
      )
        throw new Error(
          'The live credential has expired or is invalid. Request access again.',
        );
      if (this.room) {
        if (
          this.room !== input.roomId ||
          this.identity !== input.userId ||
          this.role !== input.role
        )
          throw new Error('A different live room is already open.');
        return;
      }
      this.room = input.roomId;
      this.identity = input.userId;
      this.role = input.role;
      this.update({ connection: 'connecting', error: null });
      try {
        const result = await this.engine.loginRoom(
          input.roomId,
          {
            userID: input.userId,
            userName: input.role === 'host' ? 'Lesson presenter' : 'Learner',
          },
          { token: input.token, isUserStatusNotify: false, maxMemberCount: 0 },
        );
        if (result.errorCode) throw new Error('login');
        if (this.closed) return;
        if (input.role === 'host') {
          await this.engine.startPublishingStream(
            's_' + input.userId,
            undefined,
            undefined,
          );
        }
        this.update({ connection: 'connected' });
      } catch {
        this.update({
          connection: 'error',
          error:
            'School access was granted, but the media room could not connect. Leave and try again.',
        });
        throw new Error(
          'School access was granted, but the media room could not connect. Leave and try again.',
        );
      }
      // Credential remains only in this call frame; never stored on the client.
    });
  }
  attachRemote(id: string, view: number) {
    return this.run(async () => {
      if (!this.state.participants.some(p => p.streamId === id)) return;
      try {
        await this.engine!.startPlayingStream(
          id,
          {
            reactTag: view,
            viewMode: this.sdk!.ZegoViewMode.AspectFit,
            backgroundColor: 0,
          },
          undefined,
        );
      } catch {
        this.mediaError(id);
        throw new Error('Lesson video could not attach.');
      }
    });
  }
  muteMicrophone(muted: boolean) {
    return this.run(async () => {
      if (this.role === 'participant' || !this.engine)
        throw new Error('Learners cannot publish audio.');
      await this.engine.muteMicrophone(muted);
      this.update({ microphoneMuted: muted });
    });
  }
  enableCamera(enabled: boolean) {
    return this.run(async () => {
      if (this.role === 'participant' || !this.engine)
        throw new Error('Learners cannot publish video.');
      await this.engine.enableCamera(enabled, undefined);
      this.update({ cameraEnabled: enabled });
    });
  }
  onTokenExpiring(handler: () => void) {
    this.expiry = handler;
  }
  onReconnect(handler: (phase: 'reconnecting' | 'recovered') => void) {
    this.reconnect = handler;
  }
  renew(input: LiveCredential) {
    return this.run(async () => {
      if (
        !this.engine ||
        input.roomId !== this.room ||
        input.userId !== this.identity ||
        input.role !== this.role ||
        input.provider !== 'zegocloud' ||
        input.appId !== this.appId ||
        !Number.isFinite(Date.parse(input.expiresAt)) ||
        Date.parse(input.expiresAt) <= Date.now()
      )
        throw new Error(
          'Live access has expired. Leave and request access again.',
        );
      await this.engine.renewToken(input.roomId, input.token);
    });
  }
  dispose(): Promise<void> {
    if (this.disposal) return this.disposal;
    const removed = this.state.connection === 'removed';
    this.update({ connection: 'disconnecting' });
    this.closed = true;
    this.expiry = undefined;
    this.reconnect = undefined;
    clearTimeout(this.reconnectDeadline);
    this.disposal = this.tail
      .catch(() => undefined)
      .then(async () => {
        let failed = false;
        const attempt = async (fn: () => Promise<unknown>) => {
          try {
            await fn();
          } catch {
            failed = true;
          }
        };
        this.removers.forEach(remove => {
          try {
            remove();
          } catch {
            failed = true;
          }
        });
        this.removers = [];
        if (this.engine) {
          await attempt(() => this.engine!.muteMicrophone(true));
          await attempt(() => this.engine!.enableCamera(false, undefined));
          if (this.role === 'host')
            await attempt(() => this.engine!.stopPublishingStream(undefined));
          for (const participant of this.state.participants)
            await attempt(() =>
              this.engine!.stopPlayingStream(participant.streamId),
            );
          await attempt(() => this.engine!.stopPreview(undefined));
          if (this.room)
            await attempt(() => this.engine!.logoutRoom(this.room!));
          await attempt(() => this.sdk!.default.destroyEngine());
        }
        if (owner === this) owner = null;
        this.engine = undefined;
        this.room = undefined;
        this.identity = undefined;
        this.role = undefined;
        this.update({
          ...initialRtcState,
          connection: removed ? 'removed' : 'disconnected',
          participants: [],
          error: failed
            ? 'Media cleanup encountered a problem. Check your device camera and microphone indicators.'
            : this.state.error,
        });
        this.listeners.clear();
      });
    return this.disposal;
  }
}
export const createLiveLessonClient = (): LiveLessonClient =>
  new ZegoLiveLessonClient();
