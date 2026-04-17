import { Router } from 'express';
import { createUser, readUser, showUser, editUser, loginUser } from '../services/user.js';
import { auth } from '../middlewares/auth.js';

const router = Router();

// Rotas públicas
router.post('/', createUser);
router.post('/login', loginUser);

// Rotas protegidas (exigem o auth middleware)
router.get('/', auth, readUser);
router.get('/:id', auth, showUser);
router.put('/:id', auth, editUser);

export default router;