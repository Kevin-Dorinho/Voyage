import { Router } from 'express';
import { createCompany, readCompany, showCompany, editCompany, deleteCompany } from '../services/company.js';
import { auth } from '../middlewares/auth.js';

const router = Router();

router.post('/', auth, createCompany);
router.get('/', readCompany);
router.get('/:id', showCompany);
router.put('/:id', auth, editCompany);
router.delete('/:id', auth, deleteCompany);

export default router;