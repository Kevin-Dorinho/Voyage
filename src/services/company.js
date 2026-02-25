import { PrismaClient } from "@prisma/client";
import { z } from 'zod';
const prisma = new PrismaClient();

export async function createCompany(req, res, _next){
    const data = req.body
    let c = await prisma.company.create({data});
    return res.status(201).json(c);
}