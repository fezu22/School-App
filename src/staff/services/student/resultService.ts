import {apiClient} from '../api/apiClient';
export interface StudentResult{resultId:string;subject:{subjectId:string;name:string};assessment:{type:'homework'|'quiz';title:string;publishedRevision:number};awardedMarks:number;maxMarks:number;percentage:number;publishedAt:string;releasedFeedback:null|{feedback:string;releasedAt:string|null}}
const request=async<T>(token:string,path:string)=>(await apiClient.request<{success:boolean;data:T}>(`/student/results${path}`,{token})).data;
export const studentResultService={list:(token:string)=>request<{items:StudentResult[];total:number}>(token,''),detail:(token:string,id:string)=>request<StudentResult>(token,`/${encodeURIComponent(id)}`)};
