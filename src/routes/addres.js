import { Router } from 'express';

import { createAdrres } from '../services/addres';

const router = router();

router.post('/', createAdrres);