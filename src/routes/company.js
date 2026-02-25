import { Router } from 'express';
import { createCompany } from '../services/company.js';


const router = Router();

router.post('/', createCompany);

export default router;