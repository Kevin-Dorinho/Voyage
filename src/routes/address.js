import { Router } from 'express';

import { createAdrress } from '../services/address.js';

const router = router();

router.post('/', createAdrress);

export default  router;