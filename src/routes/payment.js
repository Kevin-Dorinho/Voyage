import { Router } from 'express';
import {
    createPayment,
    readPayment,
    showPayment,
    editPayment,
    deletePayment
} from '../services/payment.js';
import { auth } from '../middlewares/auth.js';

const router = Router();

// Todas as operações de pagamento exigem autenticação
router.post('/', auth, createPayment);
router.get('/', auth, readPayment);
router.get('/:id', auth, showPayment);
router.put('/:id', auth, editPayment);
router.delete('/:id', auth, deletePayment);

export default router;
