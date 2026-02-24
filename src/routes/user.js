import { Router } from 'express';
import { z } from 'zod';
import { createUser } from '../services/user';

const router = Router();

router.post('/create', createUser);