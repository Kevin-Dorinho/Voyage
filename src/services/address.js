import { PrismaClient } from "@prisma/client";
import { z } from 'zod';
const prisma = new PrismaClient();

//req: requisição o que está vindo do front end
//res: response o que eu vou responder
//next: proximo o que vou fazer a seguir
export async function createAddress(req, res, _next){
    const data = req.body
    let a = await prisma.address.create({data});
    return res.status(201).json(a);
}