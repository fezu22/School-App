import {Router} from 'express';
import {bootstrapSuperAdmin} from '../controllers/bootstrap.controller';

const router = Router();

router.post('/super-admin', bootstrapSuperAdmin);

export default router;