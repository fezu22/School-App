import {apiClient} from '../api/apiClient';
const request=async<T>(token:string,path:string,method:'GET'|'POST'='GET',body?:unknown)=>(await apiClient.request<{success:boolean;data:T}>(`/student/catch-ups${path}`,{token,method,...(body===undefined?{}:{body})})).data;
export const studentCatchUpService={list:(token:string)=>request(token,''),detail:(token:string,id:string)=>request(token,`/${encodeURIComponent(id)}`),
  submitEvidence:(token:string,id:string,content:string,clientOperationId:string)=>request(token,`/${encodeURIComponent(id)}/evidence`,'POST',{content,clientOperationId})};
