import { Router } from 'express';
import { createCompany, readCompany } from '../services/company.js';


const router = Router();

router.post('/', createCompany);
router.get('/', readCompany);

export default router;