import { PrismaClient } from "@prisma/client";
import { z } from 'zod';
import { attachSave } from "../utils/save.js";
import { id } from "zod/locales";

import axios from "axios";

import "dotenv/config";

// multer direto aqui (sem middleware separado)





const prisma = new PrismaClient();

//req: requisição o que está vindo do front end
//res: response, o que eu vou responder
//next: proximo o que vou fazer a seguir
export async function createAddress(req, res, _next) {
    try {
        const createSchema = z.object({
            place: z.string()
                .min(3, "O endereço deve ter no mínimo 3 caracteres.")
                .regex(/^[a-zA-ZÀ-ÿ\s,.\-]+$/, "O endereço não pode conter números ou caracteres especiais anormais."),
            number: z.string()
                .min(1, "O número é obrigatório.")
                .regex(/^\d{1,6}(?:\s?[a-zA-Z])?$/, "O número deve ter ter até 6 números e no máximo uma letra (ex: 102 F ou 123 b)."),
            zipcode: z.string()
                .regex(/^\d{5}-?\d{3}$/, "CEP inválido. Use o formato 00000-000."),
            lat: z.preprocess((val) => parseFloat(val), z.number().min(-90, "Latitude inválida.").max(90, "Latitude inválida.")),
            long: z.preprocess((val) => parseFloat(val), z.number().min(-180, "Longitude inválida.").max(180, "Longitude inválida."))
        });

        const validation = createSchema.safeParse(req.body);

        if (!validation.success) {
            return res.status(400).json({ 
                error: "Dados de endereço inválidos.", 
                detalhes: validation.error.format() 
            });
        }

        const data = validation.data;

        let imageUrl = null;

        if (req.file) {
            imageUrl = await uploadToImgBB(req.file);
        }

        const address = await prisma.address.create({
            data: {
                place: data.place,
                number: data.number,
                zipcode: data.zipcode,
                lat: data.lat,
                long: data.long,
                url: imageUrl || "",
            },
        });

        return res.status(201).json(address);
    } catch (error) {
        console.error("Erro ao criar endereço:", error);
        return res.status(500).json({ error: "Erro interno do servidor ao tentar cadastrar o endereço." });
    }
}

export async function readAddress(req, res, _next) {
    try {
        const { lat, long, user, category, company, favorite, radius } = req.query

        let consult = {}

        if (lat && long) {
            const latitude = parseFloat(lat)
            const longitude = parseFloat(long)
            
            if (isNaN(latitude) || isNaN(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
                return res.status(400).json({ error: "Latitude ou Longitude em formato inválido ou fora dos limites." });
            }

            const r = radius ? parseFloat(radius) : 0.05 // ~5km padrão

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
            const latitude = parseFloat(lat);
            if (isNaN(latitude)) return res.status(400).json({ error: "Latitude inválida." });
            consult.lat = { equals: latitude }
        } else if (long) {
            const longitude = parseFloat(long);
            if (isNaN(longitude)) return res.status(400).json({ error: "Longitude inválida." });
            consult.long = { equals: longitude }
        }

        if (user) {
            consult.users = { some: { id: parseInt(user) } }
        }

        if (company) {
            consult.addressCompany = { some: { companyId: parseInt(company) } }
        }

        // Filtro validando e corrigido para procurar a categoria de company (associação do schema real)
        if (category) {
            const categoryExists = await prisma.company.findFirst({
                where: { category: { equals: category } }
            });

            if (!categoryExists) {
                return res.status(404).json({ error: `A categoria '${category}' não existe em nenhuma empresa cadastrada.` });
            }

            consult.addressCompany = {
                ...(consult.addressCompany || {}),
                some: {
                    ...(consult.addressCompany?.some || {}),
                    company: { category: { equals: category } }
                }
            }
        }

        if (favorite) {
            // Corrige o filtro associando ao User Favorites da empresa atrelada ao endereço
            consult.addressCompany = {
                ...(consult.addressCompany || {}),
                some: {
                    ...(consult.addressCompany?.some || {}),
                    company: { favorites: { some: { userId: parseInt(favorite) } } }
                }
            }
        }

        const address = await prisma.address.findMany({ where: consult })

        return res.status(200).json(address)
    } catch (error) {
        console.error("Erro ao ler endereços:", error);
        return res.status(500).json({ error: "Erro interno ao buscar endereços." });
    }
}

export async function showAddress(req, res, _next) {
    try {
        let id = Number(req.params.id);
        
        if (isNaN(id)) return res.status(400).json({ error: "ID de endereço inválido." });

        let a = await prisma.address.findUnique({ where: { id: id } });
        
        if (!a) {
            return res.status(404).json({ error: "Endereço não encontrado." });
        }

        return res.status(200).json(a);
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: "Erro ao buscar detalhes do endereço." });
    }
}

export async function editAddress(req, res, _next) {
    try {
        let id = Number(req.params.id);

        if (isNaN(id)) return res.status(400).json({ error: "ID de endereço inválido." });

        const editSchema = z.object({
            place: z.string()
                .regex(/^[a-zA-ZÀ-ÿ\s,.\-]+$/, "O endereço não pode conter números ou caracteres especiais anormais.")
                .optional(),
            number: z.string()
                .regex(/^\d{1,6}(?:\s?[a-zA-Z])?$/, "O número deve ter até 6 números e no máximo uma letra (ex: 102 F ou 123 b).")
                .optional(),
            zipcode: z.string()
                .regex(/^\d{5}-?\d{3}$/, "CEP inválido. Use o formato 00000-000.")
                .optional(),
            lat: z.number().min(-90).max(90).optional(),
            long: z.number().min(-180).max(180).optional()
        });

        const validation = editSchema.safeParse(req.body);

        if (!validation.success) {
            return res.status(400).json({
                error: "Dados de atualização inválidos.",
                detalhes: validation.error.format()
            });
        }

        const updateData = validation.data;

        if (req.file) {
            updateData.url = await uploadToImgBB(req.file);
        }

        const existingAddress = await prisma.address.findUnique({ where: { id: id } });

        if (!existingAddress) {
            return res.status(404).json({ error: `Endereço com id ${id} não existe e não pode ser editado.` });
        }

        const updatedAddress = await prisma.address.update({
            where: { id: id },
            data: updateData
        });

        return res.status(202).json(updatedAddress);
    } catch (error) {
        console.error("Erro ao editar o endereço:", error);
        return res.status(500).json({ error: "Erro interno no servidor ao tentar editar o endereço." });
    }
}

export async function deleteAddress(req, res, _next) {
    try {
        let id = Number(req.params.id);
        
        if (isNaN(id)) return res.status(400).json({ error: "ID de endereço inválido." });

        let d = await prisma.address.findUnique({ where: { id: id } });

        if (!d) {
            return res.status(404).json({ error: `Falha na exclusão: Endereço com id ${id} não encontrado.` });
        }
        
        await prisma.address.delete({ where: { id: id } });

        return res.status(200).json({ message: `Endereço com id ${id} deletado com sucesso.` });
    } catch (error) {
        console.error("Erro ao deletar o endereço:", error);
        return res.status(500).json({ error: "Erro interno ao tentar deletar o endereço." });
    }
}


async function uploadToImgBB(file) {
    try {
        const base64Image = file.buffer.toString("base64");

        const url = `https://api.imgbb.com/1/upload?key=${process.env.IMG_BB_KEY}`;

        const formData = new URLSearchParams();
        formData.append("image", base64Image);

        const response = await axios.post(url, formData.toString(), {
            headers: {
                "Content-Type": "application/x-www-form-urlencoded"
            }
        });

        return response.data.data.url;
    } catch (error) {
        console.error("Erro ao enviar para ImgBB:", error.response?.data || error);
        throw new Error("Erro no upload");
    }
}


