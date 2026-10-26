import { apiClient } from '../api/apiClient';
import {
  academicSetupService,
  type CatalogRecord,
} from './academicSetupService';
import {
  classSubjectService,
  type ClassSubjectRecord,
} from './classSubjectService';

async function collectPages<T>(
  load: (offset: number) => Promise<{ items: T[]; nextOffset: number | null }>,
  label: string
) {
  const items: T[] = [];
  let offset = 0;
  for (;;) {
    const page = await load(offset);
    items.push(...page.items);
    if (page.nextOffset === null) return items;
    if (page.nextOffset <= offset)
      throw new Error(`${label} list could not be loaded. Please retry.`);
    offset = page.nextOffset;
  }
}

export type TimetableSlot = {
  teacherId: string;
  classId: string;
  sectionId: string;
  subjectId: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  roomId?: string;
  room: string;
};
export type TimetableRow = TimetableSlot & {
  periodId?: string;
  teacherName: string;
  className: string;
  sectionName: string;
  subjectName: string;
};
export type TimetableVersion = {
  versionId: string;
  versionNumber: number;
  status: 'draft' | 'approved' | 'retired';
  effectiveFrom: string;
  effectiveUntil: string;
  periods: TimetableRow[];
};
export type TeacherEligibility = {
  asOf: string;
  reasons: string[];
};
export type TimetableOptions = {
  teacherEligibility?: TeacherEligibility;
  branches: { id: string; name: string }[];
  branchId: string | null;
  branchFixed: boolean;
  timezone: string;
  today: string;
  teachers: { id: string; name: string }[];
  nextTeacherOffset: number | null;
  tuples: {
    assignmentId: string;
    classId: string;
    className: string;
    sectionId: string;
    sectionName: string;
    subjectId: string;
    subjectName: string;
    academicPeriodId: string;
    academicPeriodName: string;
  }[];
};
export type TimetableList = {
  currentVersion?: {
    versionId: string;
    versionNumber: number;
    effectiveFrom: string;
    effectiveUntil: string;
  } | null;
  items: TimetableVersion[];
  nextVersionNumber: number;
  nextOffset: number | null;
};
const query = (input: Record<string, string | number | undefined>) => {
  const entries = Object.entries(input).filter(
    ([, v]) => v !== undefined && v !== ''
  );
  return entries.length
    ? '?' +
        entries
          .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
          .join('&')
    : '';
};
// Explicitly project the write contract: display labels/period IDs are never sent.
export const slotPayload = (p: TimetableSlot) => ({
  teacherId: p.teacherId,
  classId: p.classId,
  sectionId: p.sectionId,
  subjectId: p.subjectId,
  dayOfWeek: p.dayOfWeek,
  startTime: p.startTime,
  endTime: p.endTime,
  ...(p.roomId ? { roomId: p.roomId } : { room: p.room }),
});
export const timetableAdminService = {
  async rooms(token: string, branchId: string) {
    return collectPages<CatalogRecord>(
      (offset) =>
        academicSetupService.list(token, 'rooms', { branchId, offset }),
      'Room'
    );
  },
  async classes(token: string, branchId: string) {
    return collectPages<CatalogRecord>(
      (offset) =>
        academicSetupService.list(token, 'classes', { branchId, offset }),
      'Class'
    );
  },
  async sections(token: string, branchId: string, classId: string) {
    return collectPages<CatalogRecord>(
      (offset) =>
        academicSetupService.list(token, 'sections', {
          branchId,
          classId,
          offset,
        }),
      'Section'
    );
  },
  async subjects(token: string, branchId: string, classId: string) {
    return collectPages<ClassSubjectRecord>(async (offset) => {
      const page = await classSubjectService.list(
        token,
        classId,
        branchId,
        offset
      );
      if (!page.writable)
        throw new Error(
          'The selected Class or Academic Period is no longer active. Refresh academic context.'
        );
      return page;
    }, 'Subject');
  },
  async eligibleTeachers(
    token: string,
    branchId: string,
    classId: string,
    sectionId: string,
    subjectId: string
  ) {
    let eligibility: TeacherEligibility | undefined;
    const items = await collectPages<{ id: string; name: string }>(
      async (offset) => {
        const page = await timetableAdminService.options(token, {
          branchId,
          classId,
          sectionId,
          subjectId,
          offset,
        });
        if (offset === 0) eligibility = page.teacherEligibility;
        return { items: page.teachers, nextOffset: page.nextTeacherOffset };
      },
      'Teacher'
    );
    return { items, eligibility };
  },
  async options(
    token: string,
    input: {
      branchId?: string;
      teacherId?: string;
      classId?: string;
      sectionId?: string;
      subjectId?: string;
      offset?: number;
    }
  ) {
    return (
      await apiClient.request<{ data: TimetableOptions }>(
        '/timetables/options' + query(input),
        { token }
      )
    ).data;
  },
  async list(token: string, branchId: string, offset = 0) {
    return (
      await apiClient.request<{ data: TimetableList }>(
        '/timetables/versions' + query({ branchId, offset }),
        { token }
      )
    ).data;
  },
  async create(
    token: string,
    input: {
      branchId: string;
      versionNumber: number;
      effectiveFrom: string;
      effectiveUntil: string;
      periods: TimetableSlot[];
    }
  ) {
    return (
      await apiClient.request<{ data: { versionId: string; status: string } }>(
        '/timetables/versions',
        {
          token,
          method: 'POST',
          body: {
            branchId: input.branchId,
            versionNumber: input.versionNumber,
            effectiveFrom: input.effectiveFrom,
            effectiveUntil: input.effectiveUntil,
            periods: input.periods.map(slotPayload),
          },
        }
      )
    ).data;
  },
  async approve(token: string, id: string) {
    return apiClient.request(
      `/timetables/versions/${encodeURIComponent(id)}/approve`,
      { token, method: 'POST', body: {} }
    );
  },
};
