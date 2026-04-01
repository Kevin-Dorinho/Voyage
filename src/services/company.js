import { PrismaClient } from "@prisma/client";
import { z } from 'zod';
import { attachSave } from "../utils/save.js";

const prisma = new PrismaClient();

const companySchema = z.object({
    name: z.string({ required_error: "Nome é obrigatório" }).min(3, "Nome muito curto (possível nome fictício)"),
    category: z.enum([
        "Lanchonete", "Restaurante", "Pizzaria", "Churrascaria", 
        "Supermercado", "Farmácia", "Serviços", "Outros", "Bar"
    ], { 
        errorMap: () => ({ message: "A categoria não existe / é inválida. Use uma categoria válida." })
    }),
    cnpj: z.string({ required_error: "CNPJ é obrigatório" })
        .regex(/^\d{2}\.\d{3}\.\d{3}\/\d{4}\-\d{2}$|^\d{14}$/, "CNPJ inválido. Use verifique a formatação do campo."),
    evaluate: z.number().optional(),
    places: z.string({ required_error: "Endereço é obrigatório" }).min(5, "Endereço incorreto / muito curto forneça detalhes do local")
});

export async function createCompany(req, res, _next){
    try {
        const data = companySchema.parse(req.body);
        let c = await prisma.company.create({data});
        return res.status(201).json(c);
    } catch (error) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ errors: error.errors.map(e => e.message) });
        }
        return res.status(500).json({ error: "Erro interno no servidor." });
    }
}

export async function readCompany(req, res, _next) {
    
    const {name, places, category } = req.query

    let consult = {}

    if (name) consult.name = {contains: "%"+name+"%"}
    if (places) consult.places = {contains: "%"+places+"%"}
    if (category) consult.category = {contains: "%"+category+"%"}

    let companies = await prisma.company.findMany({where: consult})
    return res.status(200).json(companies);
}

export async function editCompany(req, res, _next) {
    try {
        const parsedBody = companySchema.partial().parse(req.body);
        const {name, places, category, cnpj } = parsedBody;

        let id = Number(req.params.id);
        let c = await prisma.company.findFirst({where: {id: id}})

        if(!c){
            return res.status(404).json("Não econtrei " + id);
        }

        c = attachSave(c, 'company');
        
        if (name) c.name = name
        if (places) c.places = places
        if (category) c.category = category
        if (cnpj) c.cnpj = cnpj

        await c.save();
        
        return res.status(202).json(c);
    } catch (error) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ errors: error.errors.map(e => e.message) });
        }
        return res.status(500).json({ error: "Erro interno no servidor." });
    }
}

export async function deleteCompany(req, res, _next){

    let id = Number(req.params.id);
    let c = await prisma.company.findFirst({where: {id: id}})

     if(c){
        let c = await prisma.company.delete({where: {id: id}})
        return res.status(200).json ("USUARIO DELETADO " + id );
    }else{
        return res.status(404).json("Não econtrei " + id);
    }

}

export async function showCompany(req, res, _next) {
    let id = Number(req.params.id);
    let c = await prisma.company.findFirst({where: {id: id} });
    return res.status(202).json(c);
}