import {Router, type Response} from 'express';
import {authenticateToken, type AuthenticatedRequest} from '../middleware/auth.middleware';
import {requireRole} from '../middleware/rbac.middleware';
import {RequestContractError} from '../utils/request-validation';
import {getStudentCatchUp, getTeacherCatchUp, listStudentCatchUps, listTeacherCatchUps,
  mutateTeacherCatchUp, submitStudentCatchUpEvidence} from '../services/catch-up.service';

const token=(request:AuthenticatedRequest)=>request.authContext!;
const handle=(action:(request:AuthenticatedRequest)=>Promise<unknown>)=>async(request:AuthenticatedRequest,response:Response)=>{try{
  if(request.method==='GET'&&(request.body!==undefined||Object.keys(request.query).length))throw new RequestContractError(400,'Unsupported request fields');
  response.setHeader('Cache-Control','no-store');response.json({success:true,data:await action(request)});
}catch(error){response.status(error instanceof RequestContractError?error.status:500).json({success:false,
  message:error instanceof RequestContractError?error.message:'Catch-up operation failed. Please retry.'});}};
export const teacherCatchUpRouter=Router();teacherCatchUpRouter.use(authenticateToken,requireRole('teacher'));
teacherCatchUpRouter.get('/',handle(request=>listTeacherCatchUps(request.user)));
teacherCatchUpRouter.get('/:catchUpId',handle(request=>getTeacherCatchUp(request.user,request.params.catchUpId)));
teacherCatchUpRouter.post('/:catchUpId',handle(request=>mutateTeacherCatchUp(request.user,token(request),request.params.catchUpId,request.body)));
export const studentCatchUpRouter=Router();studentCatchUpRouter.use(authenticateToken,requireRole('student'));
studentCatchUpRouter.get('/',handle(request=>listStudentCatchUps(request.user)));
studentCatchUpRouter.get('/:catchUpId',handle(request=>getStudentCatchUp(request.user,request.params.catchUpId)));
studentCatchUpRouter.post('/:catchUpId/evidence',handle(request=>submitStudentCatchUpEvidence(request.user,token(request),request.params.catchUpId,request.body)));
