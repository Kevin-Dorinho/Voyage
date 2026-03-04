import { Router } from 'express';
import { createUser,readUser,showUser} from '../services/user.js';

const router = Router();

router.post('/', createUser);
router.get('/', readUser);
router.get('/:id', showUser)

export default router;