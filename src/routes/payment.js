import { Router } from 'express';
import { z } from 'zod';
import { createUser } from '../services/payment';

const router = Router();

router.post('/', createUser);
