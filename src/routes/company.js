import { Router } from 'express';
import { creatCompany } from '../services/company';
import { useDebugValue } from 'react';

const router = router();

router.post('/', creatCompany);

export default router;