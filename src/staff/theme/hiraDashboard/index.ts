import { Platform, ViewStyle } from 'react-native';
import { colors } from './colors';

export { colors } from './colors';
export { fonts, typography } from './typography';

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 17,
  xl: 22,
  xxl: 30,
} as const;

// Mobile radii used in the prototype
export const radius = {
  sm: 8,
  md: 11,
  lg: 14,
  card: 17,
  hero: 19,
  pill: 30,
} as const;

// CSS used two stacked shadows ("0 6px 0" solid edge + soft blur).
// React Native allows only one, so the solid edge is a thicker bottom border
// and the soft blur is the platform shadow.
export const cardShadow: ViewStyle = Platform.select({
  ios: {
    shadowColor: '#73635f',
    shadowOpacity: 0.06,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
  },
  default: { elevation: 2 },
}) as ViewStyle;

export const flatShadow: ViewStyle = Platform.select({
  ios: {
    shadowColor: '#26385b',
    shadowOpacity: 0.03,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 2 },
  },
  default: { elevation: 1 },
}) as ViewStyle;

export const theme = { colors, spacing, radius };
export type Theme = typeof theme;
