import { Router } from 'express';
import { creatCompany } from '../services/company';

const router = router();
router.post('/', creatCompany);