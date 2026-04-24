import { PrismaClient } from "@prisma/client";
import { z } from 'zod';
import { attachSave } from "../utils/save.js";

const prisma = new PrismaClient();

function isValidCNPJ(cnpj) {
    cnpj = cnpj.replace(/[^\d]+/g, '');
    if (cnpj.length !== 14) return false;
    if (/^(\d)\1+$/.test(cnpj)) return false;

    let size = cnpj.length - 2;
    let numbers = cnpj.substring(0, size);
    let digits = cnpj.substring(size);
    let sum = 0;
    let pos = size - 7;
    for (let i = size; i >= 1; i--) {
        sum += numbers.charAt(size - i) * pos--;
        if (pos < 2) pos = 9;
    }
    let result = sum % 11 < 2 ? 0 : 11 - sum % 11;
    if (result != digits.charAt(0)) return false;

    size = size + 1;
    numbers = cnpj.substring(0, size);
    sum = 0;
    pos = size - 7;
    for (let i = size; i >= 1; i--) {
        sum += numbers.charAt(size - i) * pos--;
        if (pos < 2) pos = 9;
    }
    result = sum % 11 < 2 ? 0 : 11 - sum % 11;
    if (result != digits.charAt(1)) return false;

    return true;
}

const companySchema = z.object({
    name: z.string({ required_error: "Nome é obrigatório" }).min(3, "Nome muito curto (possível nome fictício)"),
    category: z.enum([
        "Lanchonete", "Restaurante", "Pizzaria", "Churrascaria",
        "Supermercado", "Farmácia", "Serviços", "Hospital", "Outros", "Bar"
    ], {
        errorMap: () => ({ message: "A categoria não existe / é inválida. Use uma categoria válida." })
    }),
    cnpj: z.string({ required_error: "CNPJ é obrigatório" })
        .regex(/^\d{2}\.\d{3}\.\d{3}\/\d{4}\-\d{2}$|^\d{14}$/, "CNPJ inválido. Verifique a formatação do campo.")
        .refine((val) => isValidCNPJ(val), { message: "CNPJ inválido (não passou na verificação de dígitos matemáticos)." }),
    evaluate: z.number({ invalid_type_error: "A avaliação deve ser um número." })
        .min(0, "Agradecemos seu prestigio com a empresa mas o limite é até zero.")
        .max(5, "Agradecemos seu prestigio com a empresa mas o limite é até cinco.")
        .optional(),
    places: z.string({ required_error: "Endereço é obrigatório" }).min(5, "Endereço incorreto / muito curto forneça detalhes do local")
});

export async function createCompany(req, res, _next) {
    try {
        const data = companySchema.parse(req.body);

        if (data.cnpj) {
            const cnpjInUse = await prisma.company.findFirst({ where: { cnpj: data.cnpj } });
            if (cnpjInUse) {
                return res.status(409).json({ error: "O CNPJ informado já está em uso" });
            }
        }

        let c = await prisma.company.create({ data });
        return res.status(201).json(c);
    } catch (error) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ errors: error.issues.map(e => e.message) });
        }
        return res.status(500).json({ error: "Erro interno no servidor." });
    }
}

export async function readCompany(req, res, _next) {
    const { name, places, category } = req.query

    let consult = {}

    if (name) consult.name = { contains: "%" + name + "%" }
    if (places) consult.places = { contains: "%" + places + "%" }
    if (category) consult.category = { contains: "%" + category + "%" }

    let companies = await prisma.company.findMany({ where: consult })
    return res.status(200).json(companies);
}

export async function editCompany(req, res, _next) {
    try {
        const parsedBody = companySchema.partial().parse(req.body);
        const { name, places, category, cnpj } = parsedBody;

        let id = Number(req.params.id);
        let c = await prisma.company.findFirst({ where: { id: id } })

        if (!c) {
            return res.status(404).json("Não econtrei " + id);
        }

        const userId = req.logged?.id;

        if (!userId) {
            return res.status(401).json({ error: "Autenticação necessária." });
        }

        if (c.userId !== userId) {
            return res.status(403).json({ error: "Acesso negado. Você só pode editar as suas próprias empresas." });
        }

        c = attachSave(c, 'company');

        if (name) c.name = name
        if (places) c.places = places
        if (category) c.category = category
        if (cnpj) {
            const cnpjInUse = await prisma.company.findFirst({ where: { cnpj: cnpj, id: { not: id } } });
            if (cnpjInUse) {
                return res.status(409).json({ error: "O CNPJ informado já está em uso" });
            }
            c.cnpj = cnpj;
        }

        await c.save();

        return res.status(202).json(c);
    } catch (error) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ errors: error.issues.map(e => e.message) });
        }
        return res.status(500).json({ error: "Erro interno no servidor." });
    }
}

export async function deleteCompany(req, res, _next) {

    let id = Number(req.params.id);
    let c = await prisma.company.findFirst({ where: { id: id } })

    if (!c) {
        return res.status(404).json("Não econtrei " + id);
    }

    const userId = req.logged?.id;
    if (!userId) {
        return res.status(401).json({ error: "Autenticação necessária." });
    }

    if (c.userId !== userId) {
        return res.status(403).json({ error: "Acesso negado. Você só pode deletar as suas próprias empresas." });
    }

    await prisma.company.delete({ where: { id: id } })
    return res.status(200).json("EMPRESA DELETADA " + id);

}

export async function showCompany(req, res, _next) {
    let id = Number(req.params.id);
    let c = await prisma.company.findFirst({ where: { id: id } });
    return res.status(202).json(c);
}