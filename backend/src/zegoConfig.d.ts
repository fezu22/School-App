export interface AliasedValueResult {
  value: string;
  conflict: boolean;
  reason: string | null;
}

export interface ZegoCredentialsResult {
  valid: boolean;
  conflict: boolean;
  reason: string | null;
  appId: number;
  readonly serverSecret: string;
}

export interface ZegoConfigurationResult {
  enabled: boolean;
  conflict: boolean;
  reason: string | null;
  appId: number;
  ttlSeconds: number;
  roomPrivilegesEnabled: boolean;
  readonly serverSecret: string;
}

export function resolveAliasedValue(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
  primaryKey: string,
  aliasKey?: string,
  label?: string,
): AliasedValueResult;

export function resolveZegoCredentials(
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>,
): ZegoCredentialsResult;

export function resolveZegoConfiguration(
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>,
): ZegoConfigurationResult;

export function isZegoLiveLessonEnabled(
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>,
): boolean;
