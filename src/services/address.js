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

export async function readAddress(req, res, _next) {
    let address = await prisma.address.findMany();
    return res.status(200).json(address);
}

export async function showAddress(req, res, _next) {
    let id = Number(req.params.id);
    let a = await prisma.address.findFirst({where: {id:id} });
    return res.status(200).json(a);
}