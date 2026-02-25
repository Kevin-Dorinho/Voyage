import { PrismaClient } from "@prisma/client"; 
import { z } from 'zod';
const prisma = new PrismaClient();

//req: requisição do que esta vindo do frontend
//res: response o que vou responder
//next: proximo o que vou fazer a seguir
export async function createPayment(req, res, _next){
    const data = req.body
    let p = await prisma.payment.create({data});
    return res.status(201).json(p);
}