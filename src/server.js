import 'dotenv/config'; //chaves
import express from 'express'; // frameworks
import cors from 'cors'; // ele vai permitir a comunicação com o frontend
import companyRouter from './routes/company.js'
import userRouter from './routes/user.js'
import addressRouter from './routes/address.js'
import paymentRouter from './routes/payment.js'
import { auth } from './middlewares/auth.js';

const app = express(); // estou criando um app
app.use(cors()); // aqui falo qual cors
app.use(express.json()); // aqui falo que vai usar o formato json

// Como conversado, você configurará as exceções manualmente. 
// Atualmente o middleware barra tudo que descer daqui para Router -> Service -> DB
app.use(auth);

app.use('/company', companyRouter);
app.use('/user',    userRouter);
app.use('/address', addressRouter);
app.use('/payment', paymentRouter);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`HTTP => http://localhost:${PORT}`));