// Warm Academic Pulse shared palette across all roles (Stitch + App Dashboards reference).
export const colors = {
  primary: '#0D9488',
  primaryPressed: '#0F766E',
  secondary: '#1E3A8A',
  ink: '#0F172A',
  muted: '#475569',
  background: '#FAF8F5',
  card: '#FFFFFF',
  cardWarm: '#F5F2EB',
  border: '#EDE8DF',
  soft: '#CCFBF1',
  softBorder: '#99F6E4',
  hero: '#1E3A8A',
  heroBorder: '#172554',
  heroText: '#0F766E',
  heroLabel: '#B45309',
  shadowSolid: '#E2DDD5',
  white: '#FFFFFF',
  focus: '#0D9488',

  // Semantic states (attendance + payments)
  present: { bg: '#DCFCE7', border: '#84A98C', text: '#15803D' },
  absent: { bg: '#FEE2E2', border: '#FCA5A5', text: '#B91C1C' },
  late: { bg: '#FEF3C7', border: '#FCD34D', text: '#B45309' },
  leave: { bg: '#E0E7FE', border: '#A5B4FC', text: '#1E3A8A' },
  paid: { bg: '#CCFBF1', text: '#0F766E' },
  unpaid: { bg: '#FEE2E2', text: '#B91C1C' },
  pending: { bg: '#FEF3C7', text: '#B45309' },
  danger: { bg: '#FEE2E2', text: '#B91C1C' },

  // Top accent on the 4 dashboard stat cards
  statAccent: ['#0D9488', '#1E3A8A', '#D97706', '#4D7C0F'],
} as const;
