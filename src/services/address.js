import { PrismaClient } from "@prisma/client";
import { z } from 'zod';
import { attachSave} from "../utils/save.js";

const prisma = new PrismaClient();

//req: requisição o que está vindo do front end
//res: response, o que eu vou responder
//next: proximo o que vou fazer a seguir
export async function createAddress(req, res, _next){
    const data = req.body
    let a = await prisma.address.create({data});
    return res.status(201).json(a);
}

export async function readAddress(req, res, _next) {
    const { lat, long, user, category, company, favorite, radius } = req.query

    let consult = {}

    if (lat && long) {
        const latitude = parseFloat(lat)
        const longitude = parseFloat(long)
        const r = radius? parseFloat(radius) : 0.05 // ~5km padrão

        consult = {
            lat: {
                gte: latitude - r,
                lte: latitude + r,
            },
            long: {
                gte: longitude - r,
                lte: longitude + r,
            },
        }
    } else if (lat) {
        consult.lat = { equals: parseFloat(lat) }
    } else if (long) {
        consult.long = { equals: parseFloat(long) }
    }

    if (user) {
        consult.users = { some: { id: parseInt(user) } }
    }

    if (company) {
        consult.addressCompany = { some: { companyId: parseInt(company) } }
    }

    if (category) {
        consult.addressCategory = {some: { companiId: parsenInt(category) } }
    }

    if (favorite) {
        consult.addressFavorite = {some: {companyId: parseInt(favorite) } }
    }

    const address = await prisma.address.findMany({where: consult})

    return res.status(200).json(address)
}

export async function editAddress(req, res, _next) {
    const { lat, long, user, category, company, favorite, radius } = req.body

    let id = Number(req.params.id);

    if(!a){
        return res.status(404).json("Não encontrei "+ id);
    }

    a = attachSave(a, 'address');

    if (lat && long) {
        const latitude = parseFloat(lat)
        const longitude = parseFloat(long)
        const r = radius? parseFloat(radius) : 0.05 // ~5km padrão

        edit = {
            lat: {
                gte: latitude - r,
                lte: latitude + r,
            },
            long: {
                gte: longitude - r,
                lte: longitude + r,
            },
        }
    } else if (lat) {
        a.lat = { equals: parseFloat(lat) }
    } else if (long) {
        a.long = { equals: parseFloat(long) }
    }

    if (user) {
        a.users = { some: { id: parseInt(user) } }
    }

    if (company) {
        a.Company = { some: { companyId: parseInt(company) } }
    }

    if (category) {
        a.Category = {some: { companiId: parsenInt(category) } }
    }

    if (favorite) {
        a.Favorite = {some: {companyId: parseInt(favorite) } }
    }

    let a = await prisma.address.findFirst({where: {id:id} });

    await a.save();

    return res.status(202).json(address)
}


export async function showAddress(req, res, _next) {
    let id = Number(req.params.id);
    let a = await prisma.address.findFirst({where: {id:id} });
    return res.status(200).json(a);
}