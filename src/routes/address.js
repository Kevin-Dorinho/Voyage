import { Router } from 'express';

import multer from 'multer';

import { createAddress, readAddress, showAddress, editAddress, deleteAddress } from '../services/address.js';

import { auth } from '../middlewares/auth.js';

const upload = multer({ storage: multer.memoryStorage() });

const router = Router();

router.post('/', upload.single('file'), createAddress);
router.get('/', readAddress);
router.get('/:id', showAddress);
router.put('/:id', auth, upload.single('file'), editAddress);
router.delete('/:id', auth, deleteAddress)
router.put('/:id', editAddress);
router.delete('/:id', deleteAddress)



export default router;