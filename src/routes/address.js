import { Router } from 'express';

import { createAddress, readAddress, showAddress, editAddress } from '../services/address.js';

const router = Router();

router.post('/', createAddress);
router.get('/', readAddress);
router.get('/:id', showAddress);
router.put('/:id', editAddress )


export default  router;