// Hira shared palette (from dist/shared-theme.css). Same for every role.
export const colors = {
  primary: '#4354b4',
  primaryPressed: '#36469c',
  ink: '#283250',
  muted: '#708187',
  background: '#fff9f0',
  card: '#ffffff',
  cardWarm: '#fffdf8',
  border: '#eee7dd',
  soft: '#eff0ff',
  softBorder: '#e2e3f5',
  hero: '#ffeac4',
  heroBorder: '#f4dcb2',
  heroText: '#81745e',
  heroLabel: '#8b7147',
  shadowSolid: '#efe7db', // the "0 6px 0" bottom edge of cards
  white: '#ffffff',
  focus: '#edaa52',

  // Semantic states (attendance + payments)
  present: { bg: '#e8f5ee', border: '#6caf8b', text: '#20613f' },
  absent: { bg: '#fcebed', border: '#d98e99', text: '#a03343' },
  late: { bg: '#fff3dd', border: '#d6b575', text: '#916216' },
  leave: { bg: '#edeffd', border: '#9ba5d7', text: '#4c589b' },
  paid: { bg: '#e0f3e9', text: '#196447' },
  unpaid: { bg: '#fde7e7', text: '#a82935' },
  pending: { bg: '#fff0d5', text: '#8d5700' },
  danger: { bg: '#ffe8e4', text: '#ad4f43' },

  // Top accent on the 4 dashboard stat cards
  statAccent: ['#dddff5', '#93b8ad', '#dcc18a', '#a2acce'],
} as const;
