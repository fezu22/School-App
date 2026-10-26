import User from '../models/user';
import type { JwtPayload } from './jwt.service';
import { getTeacherScope } from './teacher-scope.service';
import {
  getTeacherTimetable,
  type TeacherPeriodDTO,
} from './teacher-timetable.service';
import { getTeacherAttendancePending } from './teacher-attendance.service';
import { getTeacherWorkAttention } from './teacher-work.service';
import { getTeacherImportantNotice } from './teacher-notice.service';
import { schoolToday, schoolTimezone } from './school-date.service';
import { RequestContractError } from '../utils/request-validation';

export const homePeriodState = (periods: TeacherPeriodDTO[], clock: string) => {
  const current = periods.find(p => p.startTime <= clock && clock < p.endTime);
  const next = periods.find(p => p.startTime > clock);
  return {
    state: current
      ? 'current'
      : next
      ? 'next'
      : periods.length
      ? 'finished'
      : 'no_periods',
    period: current ?? next ?? null,
  };
};

// A projection of existing authorized domain resolvers. No independent scope,
// approximate counts, raw documents, persistent Home data or summary cache.
export const getTeacherHome = async (identity: JwtPayload | undefined) => {
  const scope = await getTeacherScope(identity);
  const schoolDate = schoolToday(),
    timezone = schoolTimezone();
  const [teacher, timetable, attendance, work, notice] = await Promise.all([
    User.findById(scope.actorId).read('primary').select('_id fullName').lean(),
    getTeacherTimetable(identity, schoolDate),
    getTeacherAttendancePending(identity, schoolDate),
    getTeacherWorkAttention(identity),
    getTeacherImportantNotice(identity),
  ]);
  if (!teacher) throw new RequestContractError(401, 'Teacher is unavailable');
  if (schoolToday() !== schoolDate)
    throw new RequestContractError(
      503,
      'The school day changed. Please refresh Home.',
    );
  const clock = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date());
  const { state, period } = homePeriodState(timetable.periods, clock);
  const primaryAction =
    attendance.total > 0
      ? {
          type: 'attendance' as const,
          count: attendance.total,
          routeTarget: 'TeacherAttendanceQueue' as const,
        }
      : work.needsAttention
      ? {
          type: 'work' as const,
          count: work.total,
          routeTarget: 'Tasks' as const,
        }
      : notice
      ? {
          type: 'notice' as const,
          noticeId: notice.noticeId,
          title: notice.title,
          routeTarget: 'Inbox' as const,
        }
      : null;
  return {
    teacher: { id: String(teacher._id), fullName: teacher.fullName },
    schoolDate,
    timezone,
    hero: {
      state,
      greeting:
        Number(clock.slice(0, 2)) < 12
          ? 'Good morning'
          : Number(clock.slice(0, 2)) < 17
          ? 'Good afternoon'
          : 'Good evening',
      periodCount: timetable.periods.length,
      currentOrNextPeriod: period
        ? {
            periodId: period.periodId,
            date: period.date,
            startTime: period.startTime,
            endTime: period.endTime,
            className: period.className,
            sectionName: period.sectionName,
            subjectName: period.subjectName,
            room: period.room,
            isSubstitute: period.isSubstitute,
          }
        : null,
    },
    primaryAction,
  };
};
