import { PrismaClient } from "@prisma/client";
import { z } from 'zod';
import { id } from "zod/locales";
import { attachSave } from "../utils/save.js";

const prisma = new PrismaClient();

export async function createCompany(req, res, _next){
    const data = req.body
    let c = await prisma.company.create({data});
    return res.status(201).json(c);
}

export async function readCompany(req, res, _next) {
    
    const {name, places, category } = req.query

    let consult = {}

    if (name) consult.name = {contains: "%"+name+"%"}
    if (places) consult.places = {contains: "%"+address+"%"}
    if (category) consult.category = {contains: "%"+category+"%"}

    let companies = await prisma.company.findMany({where: consult})
    return res.status(200).json(companies);
}

export async function editCompany(req, res, _next) {

    const {name, places, category, cnpj } = req.body
    let id = Number(req.params.id);

    if(!u){
        return res.status(404).json("Não econtrei " + id);
    }

    u = attachSave(u, 'user');
    
    if (name) c.name = name
    if (places) c.places = places
    if (category) c.category = category
    if (cnpj) c.cnpj = cnpj

    c.save();

    let c = await prisma.company.findFirst({where: {id: id}})
    return res.status(200).json(companies);

}

export async function showCompany(req, res, _next) {
    let id = Number(req.params.id);
    let c = await prisma.company.findFirst({where: {id: id} });
    return res.status(202).json(c);
}