import { LessonPlan } from '../models/lessonPlan';
import { Syllabus } from '../models/syllabus';
import Section from '../models/section';
import User from '../models/user';
import { TimetablePeriod, TimetableVersion } from '../models/timetable';
import { scheduleWeekday } from './school-date.service';
import {
  academicMissing,
  assertManagedSyllabusContext,
  syllabusDTO,
} from './syllabus.service';

// Active operational access; historical references are retained, never rebound.
export const planAcademicContext = async (
  plan: InstanceType<typeof LessonPlan>,
) => {
  const syllabus = await Syllabus.findOne({
    _id: plan.syllabusId,
    branchId: plan.branchId,
    classId: plan.classId,
    subjectId: plan.subjectId,
    academicYear: plan.academicYear,
    status: 'published',
  }).read('primary');
  if (!syllabus) throw academicMissing();
  const { schoolClass } = await assertManagedSyllabusContext({
    classId: String(plan.classId),
    subjectId: String(plan.subjectId),
    syllabus,
  });
  const section = await Section.findOne({ isActive: true })
    .where('_id')
    .equals(plan.sectionId)
    .where('branchId')
    .equals(plan.branchId)
    .where('classId')
    .equals(plan.classId)
    .read('primary');
  const unit = syllabus.units.find(u => String(u._id) === String(plan.unitId));
  if (
    !section ||
    !unit ||
    plan.topicIds.some(
      id => !unit.topics.some(t => String(t._id) === String(id)),
    )
  )
    throw academicMissing();
  const teacher = await User.findOne({ role: 'teacher', isActive: true })
    .where('_id')
    .equals(plan.teacherId)
    .where('branchId')
    .equals(plan.branchId)
    .select('fullName')
    .read('primary');
  if (!teacher) throw academicMissing();
  if (plan.occurrence) {
    const version = await TimetableVersion.findOne({
      branchId: plan.branchId,
      status: 'approved',
      effectiveFrom: { $lte: plan.occurrence.date },
      effectiveUntil: { $gt: plan.occurrence.date },
    })
      .sort({ versionNumber: -1 })
      .read('primary');
    if (
      !version ||
      String(version._id) !== String(plan.occurrence.timetableVersionId) ||
      plan.teachingDate !== plan.occurrence.date ||
      !(await TimetablePeriod.exists({
        _id: plan.occurrence.periodId,
        branchId: plan.branchId,
        timetableVersionId: version._id,
        classId: plan.classId,
        sectionId: plan.sectionId,
        subjectId: plan.subjectId,
        dayOfWeek: scheduleWeekday(plan.occurrence.date),
      }).read('primary'))
    )
      throw academicMissing();
  }
  return {
    syllabus,
    syllabusDTO: syllabusDTO(syllabus),
    className: schoolClass.name,
    sectionName: section.name,
    teacherName: teacher.fullName,
  };
};
