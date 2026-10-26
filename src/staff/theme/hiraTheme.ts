import {Platform} from 'react-native';

export const colors = {
  primary: '#23595a',
  cream: '#fbf9f4',
  ink: '#213c44',
  muted: '#708187',
  lime: '#dbefae',
  line: '#e9eae1',
  yellow: '#ffdd80',
  softBlue: '#e5effb',
  softOrange: '#fbc4a7',
  softPurple: '#ece6fa',
  white: '#ffffff',
  danger: '#b95555',
  dangerSoft: '#fbe7e4',
  success: '#3d745c',
};

export const fonts = {
  display: Platform.select({ios: 'Nunito-ExtraBold', android: 'Nunito-ExtraBold', default: 'System'}),
  heading: Platform.select({ios: 'Nunito-Bold', android: 'Nunito-Bold', default: 'System'}),
  body: Platform.select({ios: 'DM Sans', android: 'DM Sans', default: 'System'}),
  bodyMedium: Platform.select({ios: 'DM Sans Medium', android: 'DM Sans Medium', default: 'System'}),
  bodySemiBold: Platform.select({ios: 'DM Sans SemiBold', android: 'DM Sans SemiBold', default: 'System'}),
};

export const shadow = {
  shadowColor: '#243e42',
  shadowOffset: {width: 0, height: 8},
  shadowOpacity: 0.06,
  shadowRadius: 16,
  elevation: 3,
};
