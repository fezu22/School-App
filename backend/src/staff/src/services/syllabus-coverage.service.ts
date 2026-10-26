import { LessonDelivery } from '../models/lessonDelivery';
import { LessonPlan } from '../models/lessonPlan';
import { Syllabus } from '../models/syllabus';
import { teacherAcademicContext } from './syllabus.service';
import type { JwtPayload } from './jwt.service';

// Canonical projection. Only the latest accepted evidence revision contributes;
// unique syllabus IDs deduplicate repeated lessons. Partial has no numeric weight.
export const resolveCoverage = async (
  syllabus: InstanceType<typeof Syllabus>,
  sectionId: string,
) => {
  const deliveries = await LessonDelivery.find({
    branchId: syllabus.branchId,
    syllabusId: syllabus._id,
    syllabusVersion: syllabus.version,
    classId: syllabus.classId,
    sectionId,
    subjectId: syllabus.subjectId,
    academicYear: syllabus.academicYear,
    state: 'recorded',
  }).read('primary');
  const plans = await LessonPlan.find({
    _id: { $in: deliveries.map(d => d.lessonPlanId) },
    branchId: syllabus.branchId,
    syllabusId: syllabus._id,
    state: 'approved',
  }).read('primary');
  const planMap = new Map(plans.map(p => [String(p._id), p]));
  const evidence = new Map<string, 'partial' | 'completed'>();
  for (const row of deliveries) {
    const plan = planMap.get(String(row.lessonPlanId));
    const latest = row.history.find(h => h.revision === row.revision);
    if (
      !plan ||
      !latest ||
      plan.approvedRevision !== row.lessonPlanRevision ||
      !plan.submissions.some(s => s.revision === row.lessonPlanRevision) ||
      String(plan.sectionId) !== sectionId ||
      String(plan.unitId) !== String(row.unitId) ||
      String(plan.classId) !== String(row.classId) ||
      String(plan.subjectId) !== String(row.subjectId) ||
      plan.academicYear !== row.academicYear ||
      latest.topics.length !== plan.topicIds.length ||
      new Set(latest.topics.map(t => String(t.topicId))).size !==
        plan.topicIds.length ||
      latest.topics.some(
        t => !plan.topicIds.some(id => String(id) === String(t.topicId)),
      )
    )
      continue;
    for (const topic of latest.topics) {
      if (topic.state === 'not_covered') continue;
      const id = String(topic.topicId);
      if (evidence.get(id) !== 'completed') evidence.set(id, topic.state);
    }
  }
  const count = (states: string[]) => ({
    totalTopics: states.length,
    completedTopics: states.filter(s => s === 'completed').length,
    partialTopics: states.filter(s => s === 'partial').length,
    pendingTopics: states.filter(s => s === 'pending').length,
  });
  const units = syllabus.units.map(u => {
    const topics = u.topics.map(t => ({
      topicId: String(t._id),
      title: t.title,
      state: evidence.get(String(t._id)) ?? 'pending',
    }));
    return {
      unitId: String(u._id),
      title: u.title,
      topics,
      ...count(topics.map(t => t.state)),
    };
  });
  const totals = count(units.flatMap(u => u.topics.map(t => t.state)));
  return {
    syllabusId: String(syllabus._id),
    version: syllabus.version,
    sectionId,
    ...totals,
    completedPercentage: totals.totalTopics
      ? Math.floor((100 * totals.completedTopics) / totals.totalTopics)
      : 0,
    units,
  };
};
export const getTeacherCoverage = async (
  identity: JwtPayload | undefined,
  context: unknown,
) => {
  const ctx = await teacherAcademicContext(identity, context);
  return ctx.syllabus
    ? resolveCoverage(ctx.syllabus, ctx.tuple.sectionId)
    : null;
};
