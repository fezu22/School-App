export type RtcRole = 'host' | 'participant';
export interface RtcCredentialRequest {
  sessionId: string;
  roomId: string;
  actorId: string;
  role: RtcRole;
  expiresAt: Date;
}
export interface RtcCredential {
  provider: string;
  appId: number;
  roomId: string;
  userId: string;
  token: string;
  expiresAt: string;
  role: RtcRole;
}
// Implementations must be local, side-effect-free signers: transaction callbacks
// can retry. Never create external rooms or make network calls here.
export interface RtcProvider {
  readonly name: string;
  publicConfig(): { provider: string; appId: number };
  roomId(sessionId: string): string;
  issueCredential(request: RtcCredentialRequest): RtcCredential;
}
// Future authenticated adapters normalize events at this boundary. No public
// callback endpoint exists until provider verification and deduplication exist.
export interface RtcProviderEvent {
  provider: string;
  eventId: string;
  roomId: string;
  occurredAt: Date;
  type:
    | 'roomStarted'
    | 'roomEnded'
    | 'participantJoined'
    | 'participantLeft'
    | 'recordingStarted'
    | 'recordingCompleted'
    | 'recordingFailed';
}
