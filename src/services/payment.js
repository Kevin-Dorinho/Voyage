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

export async function readPayment(req, res, _next) {
    const {companyId, to_date, due_date, paymentForm, advertising, type} = req.query
    
    let consult = {}
    if(companyId) consult.companyId = Number (companyId)
    if(to_date && due_date) consult.to_date = {lt: Number(to_date), gt: Number(due_date)}
    if(paymentForm) consult.paymentForm = {contains: "%"+paymentForm+"%"}
    if(advertising) consult.advertising = {contains: "%"+advertising+"%"}
    if(type) consult.type = {contains: "%"+type+"%"}

    let payments = await prisma.payment.findMany({where: consult});

    return res.status(200).json(payments);
}

    

export async function showPayment(req, res, _next) {
    let id = Number(req.params.id);
    let p = await prisma.payment.findFirst({where: {id:id} });
    return res.status(200).json(p);
}