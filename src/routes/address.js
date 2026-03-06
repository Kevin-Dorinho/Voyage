import { Router } from 'express';

import { createAddress, readAddress, showAddress } from '../services/address.js';

const router = Router();

router.post('/', createAddress);
router.get('/', readAddress);
router.get('/:id', showAddress)

export default  router;