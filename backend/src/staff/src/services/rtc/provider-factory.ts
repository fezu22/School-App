import type { RtcProvider } from './rtc-provider';
import { ZegoRtcProvider } from './zego-rtc-provider';
// Lazy validation keeps an optional unconfigured provider from blocking startup.
export const rtcProvider = (): RtcProvider => new ZegoRtcProvider();
