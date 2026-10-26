import {apiClient} from '../api/apiClient';

export type NotificationCategory='notice'|'attendance'|'timetable'|'assigned_work'|'submission_review'|'catch_up'|'result_status'|'communication'|'system';
export type NotificationDeepLink={type:'inbox_notice'|'teacher_timetable'|'attendance_period'|'submission_review'|'catch_up_item';targetId:string}|null;
export interface TeacherNotification{notificationId:string;category:NotificationCategory;title:string;body:string;priority:'low'|'normal'|'high'|'urgent';createdAt:string;availableAt:string;readAt:string|null;source:{type:string;revision:number};deepLink:NotificationDeepLink}
export interface NotificationPreferences{enabledCategories:NotificationCategory[];quietHours:{enabled:boolean;start:string;end:string;timezone:string};revision:number;updatedAt:string|null}
export interface DeviceSession{sessionId:string;label:string;createdAt:string;current:boolean;revoked:boolean;revokedAt:string|null}
const request=async<T>(token:string,path:string,method:'GET'|'POST'|'PUT'='GET',body?:unknown)=>(await apiClient.request<{success:boolean;data:T}>(`/teacher${path}`,{token,method,...(body===undefined?{}:{body})})).data;
export const notificationOperationId=(action:string)=>`${action}_${Date.now()}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;
export const notificationService={
  list:(token:string,offset=0)=>request<{items:TeacherNotification[];total:number;unread:number;nextOffset:number|null}>(token,`/notifications?offset=${offset}`),
  markRead:(token:string,id:string,clientOperationId:string)=>request<TeacherNotification>(token,`/notifications/${encodeURIComponent(id)}/read`,'POST',{clientOperationId}),
  preferences:(token:string)=>request<NotificationPreferences>(token,'/notification-preferences'),
  savePreferences:(token:string,body:Record<string,unknown>)=>request<NotificationPreferences>(token,'/notification-preferences','PUT',body),
  sessions:(token:string)=>request<{items:DeviceSession[];total:number;currentSessionPolicy:'sign_out_only'}>(token,'/device-sessions'),
  revokeSession:(token:string,id:string)=>request<DeviceSession>(token,`/device-sessions/${encodeURIComponent(id)}/revoke`,'POST',{}),
};
