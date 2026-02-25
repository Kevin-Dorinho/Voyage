import { Router } from 'express';
import { creatCompany } from '../services/company.js';
import { useDebugValue } from 'react';

const router = router();

router.post('/', creatCompany);

export default router;