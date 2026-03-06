import { PrismaClient } from "@prisma/client";
import { z } from 'zod';
const prisma = new PrismaClient();

//rec: requisição, o que está vindo do front end
//res: response ou responder, o que eu vou responder
//nest: próximo, o que eu vou fazer a seguir
export async function createUser(req, res, _next){
    const data = req.body
    let u = await prisma.user.create({data});
    return res.status(201).json(u);
}

export async function readUser(req, res, _next){
    const {name,type,signature,email} = req.query;
    
    let consult = {}
    if (name) consult.name = {contains: "%"+name+"%"}
    if (email) consult.email = {contains: "%"+email+"%"}
    if (type) consult.type = {contains: "%"+type+"%"}
    if (signature) consult.signature = {contains: "%"+signature+"%"}

    let users = await prisma.user.findMany({where: consult})

    return res.status(200).json(users);
}

export async function showUser(req, res, _next){
    let id = Number(req.params.id);
    let u = await prisma.user.findFirst({where: {id:id} });
    return res.status(200).json(u);
}