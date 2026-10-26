import {apiClient} from '../api/apiClient';
export interface CatchUpItem {catchUpId:string;revision:number;status:string;student:{studentId:string;fullName:string;admissionNumber:string};
  academic:{classId:string;sectionId:string;subjectId:string;className:string;sectionName:string;subjectName:string};
  absence:{originalStatus:string;effectiveStatus:string;effectiveVersion:number;occurrenceDate:string;attendanceRemainsSeparate:boolean};
  lesson:null|{lessonDeliveryId:string;revision:number;actualTeacherId:string;syllabusId:string;syllabusVersion:number;topicIds:string[];topics:{topicId:string;title:string}[]};
  resources:{resourceId:string;type:'text'|'chapter'|'resource_link';label:string;value:string}[];dueAt:string;assignedAt:string;
  evidence:{revision:number;content:string;submittedAt:string}[];review:null|{revision:number;evidenceRevision:number;accepted:boolean;note:string;reviewedAt:string};
  progress:{linkedWork:{workType:'homework'|'quiz';workId:string;publishedRevision:number;state:string;reviewed:boolean}[];manualEvidenceRevision:number;reviewState:string};
  history:{revision:number;action:string;reason:string;fromStatus:string|null;toStatus:string|null;createdAt:string}[];}
const request=async<T>(token:string,path:string,method:'GET'|'POST'='GET',body?:unknown)=>(await apiClient.request<{success:boolean;data:T}>(`/teacher/catch-ups${path}`,{token,method,...(body===undefined?{}:{body})})).data;
export const catchUpService={list:(token:string)=>request<{items:CatchUpItem[];total:number}>(token,''),detail:(token:string,id:string)=>request<CatchUpItem>(token,`/${encodeURIComponent(id)}`),
  mutate:(token:string,id:string,body:Record<string,unknown>)=>request<CatchUpItem>(token,`/${encodeURIComponent(id)}`,'POST',body)};
export const catchUpOperationId=(action:string)=>`${action}_${Date.now()}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;
