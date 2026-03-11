import { Router } from 'express';
import { createUser,readUser,showUser,editUser } from '../services/user.js';

const router = Router();

router.post('/', createUser);
router.get('/', readUser);
router.get('/:id', showUser)
router.put('/:id', editUser);

export default router;