import { PrismaClient } from "@prisma/client"; 
const prisma = PrismaClient();

//req: requisição do que esta vindo do frontend
//res: response o que vou responder
//next: proximo o que vou fazer a seguir
export async function createUser(req, res, next){
    const data = req.body
    let u = await prisma.user.create({data});
    return res.status(201).json(u);
}