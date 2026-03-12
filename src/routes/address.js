import { Router } from 'express';

import { createAddress, readAddress, showAddress, editAddress, deleteAddress } from '../services/address.js';

const router = Router();

router.post('/', createAddress);
router.get('/', readAddress);
router.get('/:id', showAddress);
router.put('/:id', editAddress );
router.delete('/:id', deleteAddress)


export default  router;