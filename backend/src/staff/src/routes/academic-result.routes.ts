import {Router, type Response} from 'express';
import {authenticateToken, type AuthenticatedRequest} from '../middleware/auth.middleware';
import {requireRole} from '../middleware/rbac.middleware';
import {RequestContractError} from '../utils/request-validation';
import {ApprovalAccessError} from '../services/approval-authority.policy';
import {createTeacherResult,getPrincipalResult,getStudentResult,getTeacherResult,listStudentResults,listTeacherResults,
  moderateResult,mutateTeacherResult,publishResult,listPrincipalResults} from '../services/academic-result.service';

const token=(request:AuthenticatedRequest)=>request.authContext!;
const handle=(action:(request:AuthenticatedRequest)=>Promise<unknown>)=>async(request:AuthenticatedRequest,response:Response)=>{try{
  if(request.method==='GET'&&request.body!==undefined)throw new RequestContractError(400,'Unsupported request body');response.setHeader('Cache-Control','no-store');response.json({success:true,data:await action(request)});
}catch(error){response.status(error instanceof RequestContractError||error instanceof ApprovalAccessError?error.status:500).json({success:false,message:error instanceof RequestContractError||error instanceof ApprovalAccessError?error.message:'Result operation failed. Please retry.'});}};

export const teacherResultRouter=Router();teacherResultRouter.use(authenticateToken,requireRole('teacher'));
teacherResultRouter.get('/',handle(request=>listTeacherResults(request.user,request.query)));
teacherResultRouter.post('/',handle(request=>createTeacherResult(request.user,token(request),request.body)));
teacherResultRouter.get('/:resultId',handle(request=>{if(Object.keys(request.query).length)throw new RequestContractError(400,'Unsupported query fields');return getTeacherResult(request.user,request.params.resultId);}));
teacherResultRouter.post('/:resultId',handle(request=>mutateTeacherResult(request.user,token(request),request.params.resultId,request.body)));

export const principalResultRouter=Router();principalResultRouter.use(authenticateToken,requireRole('principal'));
principalResultRouter.get('/',handle(request=>listPrincipalResults(request.user,request.query)));
principalResultRouter.get('/:approvalId',handle(request=>{if(Object.keys(request.query).length)throw new RequestContractError(400,'Unsupported query fields');return getPrincipalResult(request.user,request.params.approvalId);}));
principalResultRouter.post('/:approvalId/moderate',handle(request=>moderateResult(request.user,token(request),request.params.approvalId,request.body)));
principalResultRouter.post('/:approvalId/publish',handle(request=>publishResult(request.user,token(request),request.params.approvalId,request.body)));

export const studentResultRouter=Router();studentResultRouter.use(authenticateToken,requireRole('student'));
studentResultRouter.get('/',handle(request=>{if(Object.keys(request.query).length)throw new RequestContractError(400,'Unsupported query fields');return listStudentResults(request.user);}));
studentResultRouter.get('/:resultId',handle(request=>{if(Object.keys(request.query).length)throw new RequestContractError(400,'Unsupported query fields');return getStudentResult(request.user,request.params.resultId);}));
