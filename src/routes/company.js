import { Router } from 'express';
import { createCompany, readCompany, showCompany, editCompany, deleteCompany } from '../services/company.js';


const router = Router();

router.post('/', createCompany);
router.get('/', readCompany);
router.get('/:id', showCompany);
router.put('/:id', editCompany);
router.delete('/:id', deleteCompany)

export default router;