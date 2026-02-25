import { Prismaclient } from "@prisma/client";
import { z } from 'zod';
const prisma = new Prismaclient();

export async function creatCompany(rec, res, _next){
    const data = req.body
    let c = await prisma.company.create({data});
    return res.status(201).json(c);
}