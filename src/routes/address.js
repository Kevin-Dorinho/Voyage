import { Router } from 'express';

import { createAddress } from '../services/address.js';

const router = Router();

router.post('/', createAddress);

export default  router;