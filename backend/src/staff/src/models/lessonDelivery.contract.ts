/** Explicit evidence persisted by LessonDelivery; never inferred from planning or approval. */
export interface LessonDeliveryEvidence {
  deliveryId: string;
  lessonPlanId: string;
  lessonPlanRevision: number;
  syllabusId: string;
  syllabusVersion: number;
  revision: number;
  state: 'recorded' | 'voided';
  history: {
    revision: number;
    deliveryStatus: 'delivered' | 'partially_delivered' | 'not_delivered';
    actualTeachingDate: string;
    topics: {
      topicId: string;
      state: 'partial' | 'completed' | 'not_covered';
      evidence: string;
    }[];
    teacherNotes: string;
    correctionReason: string;
    recordedAt: string;
    recordedBy: string;
    recordedByName: string;
  }[];
}
export type SyllabusCoverageState = 'pending' | 'partial' | 'completed';
