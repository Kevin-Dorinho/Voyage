import { Router } from 'express';
import { createPayment, readPayment, showPayment, editPayment, deletePayment } from '../services/payment.js';

const router = Router();

router.post('/', createPayment);
router.get('/', readPayment);
router.get('/:id', showPayment);
router.put('/:id', editPayment);
router.delete('/:id', deletePayment);

export default router;
