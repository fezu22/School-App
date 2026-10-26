/* eslint-disable no-void -- UI/SDK event callbacks detach operations with local error handling. */
import {
  liveLessonService,
  liveLessonError,
  type AuthorizedRoom,
  type LiveLesson,
  type ClassroomState,
} from './liveLessonService';
import { RtcFailure, type LiveLessonClient } from './rtc/types';
type Api = typeof liveLessonService;
export type LessonTarget =
  | { kind: 'teacher'; periodId: string; date: string }
  | { kind: 'student'; sessionId: string };
export interface LiveRoomState {
  pending: boolean;
  session: LiveLesson | null;
  error: string | null;
  notice: string | null;
  closed: boolean;
  classroom?: ClassroomState;
  reliability?:
    | 'waiting'
    | 'connected'
    | 'reconnecting'
    | 'recovered'
    | 'removed'
    | 'rejected'
    | 'authorization_lost'
    | 'ended'
    | 'disconnected';
}
// Owns authorization/renewal, not media or academic authority. Credentials stay
// in call frames, and never enter navigation, React state or persistent storage.
export class LiveRoomController {
  private state: LiveRoomState = {
    pending: false,
    session: null,
    error: null,
    notice: null,
    closed: false,
  };
  private listeners = new Set<(state: LiveRoomState) => void>();
  private closed = false;
  private renewing = false;
  private renewAfter = 0;
  private finalCredential = false;
  private renewalTimer?: ReturnType<typeof setTimeout>;
  // Correlation key only; backend JWT/session + durable lease supply authority.
  private connectionId =
    'room_' +
    Date.now().toString(36) +
    '_' +
    Math.random().toString(36).slice(2) +
    Math.random().toString(36).slice(2);
  private pollTimer?: ReturnType<typeof setTimeout>;
  private polling = false;
  private connected = false;
  private pollFailures = 0;
  private offRtc?: () => void;
  private reconnectAfter = 0;
  private recovery?: Promise<void>;
  constructor(
    readonly target: LessonTarget,
    private token: string,
    readonly rtc: LiveLessonClient,
    private api: Api = liveLessonService,
  ) {
    rtc.onTokenExpiring(() => {
      void this.renew();
    });
    rtc.onReconnect?.(phase => {
      void this.reauthorizeReconnect(phase);
    });
    this.offRtc = rtc.subscribe(state => {
      if (state.connection === 'removed' && !this.closed) {
        this.update({ reliability: 'removed' });
        void this.close(
          'Media access was removed or replaced. Request school access again.',
        );
      }
    });
  }
  subscribe(listener: (state: LiveRoomState) => void) {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private update(patch: Partial<LiveRoomState>) {
    if (this.closed && !patch.closed) return;
    this.state = { ...this.state, ...patch };
    this.listeners.forEach(listener => listener(this.state));
  }
  private authorized(): Promise<AuthorizedRoom> {
    return this.target.kind === 'teacher'
      ? this.api.startLesson(
          this.token,
          this.target.periodId,
          this.target.date,
          this.connectionId,
        )
      : this.api.getJoinToken(
          this.token,
          this.target.sessionId,
          this.connectionId,
        );
  }
  private schedule(expiresAt: string) {
    clearTimeout(this.renewalTimer);
    // Renew even a configured 30-second token, but never spin on a credential
    // capped to lesson end. Timing metadata contains no bearer credential.
    const remaining = Date.parse(expiresAt) - Date.now();
    if (remaining <= 0 || !Number.isFinite(remaining))
      throw new Error('Expired live credential.');
    this.finalCredential =
      Date.parse(expiresAt) >=
      Date.parse(this.state.session!.scheduledEnd) - 1000;
    const lead = Math.min(60000, Math.max(1000, remaining / 5));
    this.renewAfter = Date.now() + remaining - lead;
    this.renewalTimer = setTimeout(
      () => {
        if (!this.finalCredential) void this.renew();
        else void this.close('The live access window has ended.');
      },
      this.finalCredential ? remaining : remaining - lead,
    );
  }
  async enter() {
    if (this.closed || this.state.pending || this.state.session) return;
    this.update({ pending: true, error: null });
    let granted = false;
    try {
      if (this.target.kind === 'student') {
        const classroom = await this.api.requestAdmission(
          this.token,
          this.target.sessionId,
          this.connectionId,
        );
        if (this.closed) return;
        this.update({
          session: classroom.session,
          classroom,
          reliability:
            classroom.participant.admission === 'admitted'
              ? 'disconnected'
              : classroom.participant.admission === 'left'
              ? 'disconnected'
              : classroom.participant.admission,
        });
        if (classroom.participant.admission !== 'admitted') {
          if (classroom.participant.admission === 'waiting')
            this.schedulePoll();
          return;
        }
      }
      const response = await this.authorized();
      granted = true;
      if (this.closed) return;
      const expected = this.target.kind === 'teacher' ? 'host' : 'participant';
      if (
        response.connection.role !== expected ||
        response.session.status !== 'live'
      )
        throw new Error('Invalid live access.');
      this.update({ session: response.session });
      await this.rtc.prepare(response.connection.appId);
      if (this.closed) return;
      await this.rtc.connect(response.connection);
      if (!this.closed) {
        this.connected = true;
        this.update({ reliability: 'connected' });
        this.schedule(response.connection.expiresAt);
        this.schedulePoll();
      }
    } catch (error) {
      this.update({
        error: granted
          ? error instanceof RtcFailure && error.kind === 'expired'
            ? 'Your live credential expired before connection. Leave and request access again.'
            : 'School access was granted, but media connection failed. Leave this screen and try again.'
          : liveLessonError(error),
        notice:
          granted && this.target.kind === 'teacher'
            ? 'The school session may already be live. You can end it here or leave and retry the same lesson.'
            : null,
      });
      if (granted) await this.rtc.dispose();
    } finally {
      this.update({ pending: false });
    }
  }
  private schedulePoll() {
    clearTimeout(this.pollTimer);
    if (!this.closed)
      this.pollTimer = setTimeout(() => {
        void this.refreshClassroom();
      }, 5000);
  }
  async refreshClassroom() {
    if (this.closed || this.polling || !this.state.session) return;
    this.polling = true;
    try {
      const classroom = await this.api.classroom(
        this.token,
        this.state.session.id,
        this.connectionId,
        this.state.reliability === 'reconnecting'
          ? 'reconnecting'
          : this.connected
          ? 'connected'
          : 'disconnected',
      );
      if (this.closed) return;
      this.pollFailures = 0;
      this.update({ classroom, session: classroom.session });
      const admission = classroom.participant.admission;
      if (admission === 'removed' || admission === 'rejected') {
        this.update({ reliability: admission });
        await this.close(
          admission === 'removed'
            ? 'The teacher removed you from this lesson.'
            : 'Your request to join was rejected.',
        );
      } else if (
        admission === 'admitted' &&
        !this.connected &&
        this.target.kind === 'student'
      ) {
        const response = await this.authorized();
        if (this.closed) return;
        if (
          response.session.id !== this.state.session.id ||
          response.connection.role !== 'participant'
        )
          throw new Error('classroom');
        await this.rtc.prepare(response.connection.appId);
        if (this.closed) return;
        try {
          await this.rtc.connect(response.connection);
        } catch {
          await this.close(
            'Admission was granted, but media could not connect. Leave and request access again.',
          );
          return;
        }
        if (this.closed) return;
        this.connected = true;
        this.update({ reliability: 'connected' });
        this.schedule(response.connection.expiresAt);
      }
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (status && [401, 403, 404, 409].includes(status)) {
        let ended = false;
        if (status === 409 && this.state.session) {
          try {
            const current = await this.api.getLiveLesson(
              this.token,
              this.state.session.id,
            );
            if (this.closed) return;
            this.update({ session: current });
            ended =
              current.status === 'ended' || current.status === 'cancelled';
          } catch {
            /* Retain the last verified school state when access was revoked. */
          }
        }
        this.update({
          reliability: ended ? 'ended' : 'authorization_lost',
        });
        await this.close(
          'Classroom access ended or your school authorization changed.',
        );
      } else if (++this.pollFailures >= 3) {
        this.update({ reliability: 'disconnected' });
        await this.close(
          'School access could not be verified. Leave and try again.',
        );
      } else
        this.update({
          notice: 'School connection is unstable. Verifying classroom access…',
        });
    } finally {
      this.polling = false;
      this.schedulePoll();
    }
  }
  async moderate(
    participantId: string,
    action: 'admit' | 'reject' | 'remove' | 'lower-hand',
  ) {
    if (
      this.closed ||
      this.state.pending ||
      this.target.kind !== 'teacher' ||
      !this.state.session
    )
      return;
    this.update({ pending: true, error: null });
    try {
      await this.api.moderate(
        this.token,
        this.state.session.id,
        participantId,
        action,
      );
      if (!this.closed) await this.refreshClassroom();
    } catch (error) {
      this.update({ error: liveLessonError(error) });
    } finally {
      this.update({ pending: false });
    }
  }
  async hand(raised: boolean) {
    if (
      this.closed ||
      this.state.pending ||
      this.target.kind !== 'student' ||
      !this.state.session
    )
      return;
    this.update({ pending: true, error: null });
    try {
      await this.api.hand(
        this.token,
        this.state.session.id,
        this.connectionId,
        raised,
      );
      if (!this.closed) await this.refreshClassroom();
    } catch (error) {
      this.update({ error: liveLessonError(error) });
    } finally {
      this.update({ pending: false });
    }
  }
  private async reauthorizeReconnect(phase: 'reconnecting' | 'recovered') {
    if (this.closed || !this.connected || !this.state.session) return;
    if (phase === 'reconnecting') this.update({ reliability: 'reconnecting' });
    try {
      if (!this.recovery && Date.now() >= this.reconnectAfter) {
        this.reconnectAfter = Date.now() + 5000;
        this.recovery = (async () => {
          const status = await this.api.classroom(
            this.token,
            this.state.session!.id,
            this.connectionId,
            'reconnecting',
          );
          if (this.closed) return;
          if (status.participant.admission !== 'admitted')
            throw new Error('access');
          await this.renew(true);
        })();
      }
      await this.recovery;
      if (this.closed) return;
      if (phase === 'recovered') {
        const status = await this.api.classroom(
          this.token,
          this.state.session.id,
          this.connectionId,
          'connected',
        );
        if (this.closed) return;
        if (status.participant.admission !== 'admitted')
          throw new Error('access');
        this.update({ reliability: 'recovered', classroom: status });
      }
    } catch {
      this.update({ reliability: 'authorization_lost' });
      await this.close(
        'School authorization could not be confirmed during reconnect.',
      );
    } finally {
      this.recovery = undefined;
    }
  }
  private async renew(force = false) {
    if (
      this.closed ||
      this.renewing ||
      !this.state.session ||
      !this.renewalTimer
    )
      return;
    // Ignore early/repeated SDK warnings for fresh short-TTL credentials. The
    // single timer still guarantees renewal before expiry.
    if (!force && (this.finalCredential || Date.now() < this.renewAfter))
      return;
    this.renewing = true;
    try {
      const response = await this.authorized();
      if (this.closed) return;
      if (
        response.session.id !== this.state.session.id ||
        response.session.status !== 'live'
      )
        throw new Error('Live session changed.');
      await this.rtc.renew(response.connection);
      if (!this.closed) this.schedule(response.connection.expiresAt);
    } catch {
      this.update({ reliability: 'authorization_lost' });
      await this.close(
        'Live access could not be renewed. Leave and request access again through the school app.',
      );
    } finally {
      this.renewing = false;
    }
  }
  async end(): Promise<boolean> {
    if (
      this.closed ||
      this.state.pending ||
      this.target.kind !== 'teacher' ||
      !this.state.session
    )
      return false;
    this.update({ pending: true, error: null });
    try {
      const ended = await this.api.endLesson(this.token, this.state.session.id);
      this.update({ session: ended });
      await this.close('Lesson ended.');
      return true;
    } catch (error) {
      this.update({ error: liveLessonError(error) });
      return false;
    } finally {
      this.update({ pending: false });
    }
  }
  async close(notice?: string) {
    if (this.closed) return this.rtc.dispose();
    this.closed = true;
    const token = this.token;
    this.token = '';
    clearTimeout(this.renewalTimer);
    clearTimeout(this.pollTimer);
    this.offRtc?.();
    this.update({
      closed: true,
      pending: false,
      ...(notice ? { notice } : {}),
    });
    await this.rtc.dispose();
    if (this.state.session && token) {
      try {
        await this.api.classroom(
          token,
          this.state.session.id,
          this.connectionId,
          'left',
        );
      } catch {
        /* Lease/expiry and maintenance recover an offline leave. */
      }
    }
  }
}
