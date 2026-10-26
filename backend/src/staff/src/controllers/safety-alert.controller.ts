import {Response} from 'express';
import {BranchScopedRequest} from '../middleware/branch.middleware';
import {objectIdField, RequestContractError, writeFailure, writeScope} from '../utils/request-validation';
import {safetyActionBody} from '../utils/principal-write.validation';
import {processSafetyAlertAction} from '../services/safety-alert.service';
import {getSafetyOverview, getSafetyAlertById, getEligibleSafetyOfficers, serializeSafetyAlerts, canViewSafetyAlerts} from '../services/safety-overview.service';

const checkQuery = (req: BranchScopedRequest, allowed: string[]) => {
  if (Object.keys(req.query).some(key => !allowed.includes(key))) throw new RequestContractError(400, 'Unsupported safety filter');
};

export const getSafetyAlertsController = async (req: BranchScopedRequest, res: Response): Promise<void> => {
  try {
    const {branchId} = writeScope(req);
    // Preserve legacy branchId-query behavior: ignored, never used as scope.
    checkQuery(req, ['status', 'severity', 'type', 'branchId']);
    const data = await getSafetyOverview(branchId, req.query, canViewSafetyAlerts());
    res.status(200).json({success: true, message: 'Safety alerts fetched successfully', data});
  } catch (error) {writeFailure(res, error);}
};

export const getSafetyAlertDetailController = async (req: BranchScopedRequest, res: Response): Promise<void> => {
  try {
    const {branchId} = writeScope(req);
    checkQuery(req, []);
    const alert = await getSafetyAlertById(objectIdField(req.params.alertId, 'alert ID'), branchId);
    const data = (await serializeSafetyAlerts([alert], true))[0];
    res.status(200).json({success: true, message: 'Safety alert fetched successfully', data});
  } catch (error) {writeFailure(res, error);}
};

export const getSafetyOfficersController = async (req: BranchScopedRequest, res: Response): Promise<void> => {
  try {
    const {branchId, actorId} = writeScope(req);
    checkQuery(req, []);
    const data = await getEligibleSafetyOfficers(objectIdField(req.params.alertId, 'alert ID'), branchId, actorId);
    res.status(200).json({success: true, message: 'Eligible officers fetched successfully', data});
  } catch (error) {writeFailure(res, error);}
};

export const processSafetyAlertActionController = async (req: BranchScopedRequest, res: Response): Promise<void> => {
  try {
    const actor = writeScope(req);
    const input = safetyActionBody(req.body);
    const alertId = objectIdField(req.params.alertId, 'alert ID');
    const alert = await processSafetyAlertAction({...actor, ...input, alertId});
    // Preserve data:null for existing callers. Confirmed state is additive.
    res.status(200).json({success: true, message: 'Safety alert action completed successfully', data: null, alert});
  } catch (error) {writeFailure(res, error);}
};
