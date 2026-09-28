import 'dotenv/config';

import './utils/config.js';

import express from 'express';
import cors from 'cors';
import { getCorsOptions } from './utils/cors.js';
import { securityHeaders } from './middlewares/security.js';

import companyRouter from './routes/company.js';
import userRouter from './routes/user.js';
import addressRouter from './routes/address.js';
import paymentRouter from './routes/payment.js';

const app = express();

// Proteções de infraestrutura e cabeçalhos HTTP
app.use(securityHeaders);
app.use(cors(getCorsOptions()));
app.use(express.json());

// Rotas do projeto
app.use('/company', companyRouter);
app.use('/user', userRouter);
app.use('/address', addressRouter);
app.use('/payment', paymentRouter);

export default app;
