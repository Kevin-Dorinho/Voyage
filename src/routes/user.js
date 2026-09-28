import { Router } from 'express';
import { createUser, readUser, showUser, editUser, loginUser } from '../services/user.js';
import { auth } from '../middlewares/auth.js';
import { loginLimiter, registerLimiter } from '../middlewares/security.js';

const router = Router();

// Rotas públicas com mitigação de força bruta e spam
router.post('/', registerLimiter, createUser);
router.post('/login', loginLimiter, loginUser);

// Rotas protegidas (exigem o auth middleware)
router.get('/', auth, readUser);
router.get('/:id', auth, showUser);
router.put('/:id', auth, editUser);

export default router;