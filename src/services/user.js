import { PrismaClient } from "@prisma/client";
const prisma = PrismaClient();

//rec: requisição, o que está vindo do front end
//res: response ou responder, o que eu vou responder
//nest: próximo, o que eu vou fazer a seguir
export async function createUser(rec, res, next){
    const data = rec.body
    let u = await prisma.user.create({data});
    return res.status(201).json(u);
}