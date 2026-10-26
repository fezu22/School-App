import { dateField, RequestContractError } from '../utils/request-validation';
// Branch has no timezone field. Central school-wide deployment setting;
// civil-date weekday arithmetic never uses server-local getters.
export const schoolTimezone = () => {
  const zone = process.env.SCHOOL_TIMEZONE || 'Asia/Karachi';
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone }).format();
  } catch {
    throw new RequestContractError(500, 'School timezone is unavailable');
  }
  return zone;
};
// One school-local civil date/time snapshot for occurrence start boundaries.
export const schoolDateTime = (instant = new Date()) => {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: schoolTimezone(),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const part = (type: string) => parts.find(item => item.type === type)!.value;
  return {
    date: `${part('year')}-${part('month')}-${part('day')}`,
    time: `${part('hour')}:${part('minute')}`,
  };
};
export const schoolToday = () => schoolDateTime().date;
export const scheduleDate = (value: unknown) => {
  dateField(value, 'schedule date', true);
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new RequestContractError(400, 'Invalid schedule date');
  return value;
};
export const addScheduleDays = (date: string, count: number) => {
  const instant = new Date(`${date}T12:00:00Z`);
  instant.setUTCDate(instant.getUTCDate() + count);
  return instant.toISOString().slice(0, 10);
};
export const scheduleWeekday = (date: string) =>
  new Date(`${date}T12:00:00Z`).getUTCDay();
