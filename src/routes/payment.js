import { Router } from 'express';
import { z } from 'zod';
import { createUser } from '../services/payment.js';

const router = Router();

router.post('/', createUser);
export default router;
