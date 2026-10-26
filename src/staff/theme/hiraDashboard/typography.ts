import { TextStyle } from 'react-native';

// Fonts: DM Sans (body) and Nunito (headings/numbers).
// Add the .ttf files, then run: npx react-native-asset
// File names must match the keys below.
export const fonts = {
  body: 'DMSans-Regular',
  bodyMedium: 'DMSans-Medium',
  bodySemi: 'DMSans-SemiBold',
  bodyBold: 'DMSans-Bold',
  headingBold: 'Nunito-Bold',
  headingExtra: 'Nunito-ExtraBold',
  headingBlack: 'Nunito-Black',
} as const;

export const typography = {
  h1: { fontFamily: fonts.bodyBold, fontSize: 25, letterSpacing: -0.4 },
  h2: {
    fontFamily: fonts.bodyBold,
    fontSize: 22,
    lineHeight: 29,
    letterSpacing: -0.4,
  },
  h3: { fontFamily: fonts.bodyBold, fontSize: 16, letterSpacing: -0.4 },
  body: { fontFamily: fonts.body, fontSize: 14, lineHeight: 22 },
  bodyStrong: { fontFamily: fonts.bodySemi, fontSize: 14 },
  small: { fontFamily: fonts.body, fontSize: 13, lineHeight: 20 },
  caption: { fontFamily: fonts.body, fontSize: 12 },
  button: { fontFamily: fonts.bodySemi, fontSize: 14 },
  statValue: { fontFamily: fonts.headingBlack, fontSize: 23 },
  bigNumber: { fontFamily: fonts.headingBlack, fontSize: 32 },
} satisfies Record<string, TextStyle>;
