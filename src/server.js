import 'dotenv/config'; //chaves
import express from 'express'; // frameworks
import cors from 'cors'; // ele vai permitir a comunicação com o frontend
import companyRouter from './routes/company'


const app = express(); // estou criando um app
app.use(cors()); // aqui falo qual cors
app.use(express.json()); // aqui falo que vai usar o formato json

app.use('/company', companyRouter);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`HTTP => http://localhost:${PORT}`));