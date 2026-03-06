import { Router } from 'express';
import { createPayment, readPayment, showPayment } from '../services/payment.js';

const router = Router();

router.post('/', createPayment);
router.get('/', readPayment);
router.get('/:id', showPayment);

export default router;
