import {Router,type Response} from 'express';
import {authenticateToken,type AuthenticatedRequest} from '../middleware/auth.middleware';
import {requireRole} from '../middleware/rbac.middleware';
import {RequestContractError} from '../utils/request-validation';
import {getTeacherNotification,getTeacherNotificationPreferences,listTeacherNotifications,listTeacherSessions,markTeacherNotificationRead,revokeOwnTeacherSession,saveTeacherNotificationPreferences} from '../services/teacher-notification.service';

const token=(request:AuthenticatedRequest)=>request.headers.authorization!.slice(7);
const handle=(action:(request:AuthenticatedRequest)=>Promise<unknown>)=>async(request:AuthenticatedRequest,response:Response)=>{try{response.setHeader('Cache-Control','no-store');response.json({success:true,data:await action(request)});}catch(error){response.status(error instanceof RequestContractError?error.status:500).json({success:false,message:error instanceof RequestContractError?error.message:'Notification operation failed. Please retry.'});}};

const router=Router();
router.use(authenticateToken,requireRole('teacher'));
router.get('/notifications',handle(request=>listTeacherNotifications(request.user,request.query)));
router.get('/notifications/:notificationId',handle(request=>{if(Object.keys(request.query).length)throw new RequestContractError(400,'Unsupported query fields');return getTeacherNotification(request.user,request.params.notificationId);}));
router.post('/notifications/:notificationId/read',handle(request=>markTeacherNotificationRead(request.user,request.params.notificationId,request.body)));
router.get('/notification-preferences',handle(request=>{if(Object.keys(request.query).length)throw new RequestContractError(400,'Unsupported query fields');return getTeacherNotificationPreferences(request.user);}));
router.put('/notification-preferences',handle(request=>saveTeacherNotificationPreferences(request.user,request.body)));
router.get('/device-sessions',handle(request=>{if(Object.keys(request.query).length)throw new RequestContractError(400,'Unsupported query fields');return listTeacherSessions(request.user,token(request));}));
router.post('/device-sessions/:sessionId/revoke',handle(request=>{if(Object.keys(request.body??{}).length)throw new RequestContractError(400,'Unsupported request fields');return revokeOwnTeacherSession(request.user,token(request),request.params.sessionId);}));
export default router;
