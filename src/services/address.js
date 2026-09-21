import { PrismaClient } from "@prisma/client";
import { z } from 'zod';
import { attachSave } from "../utils/save.js";
import axios from "axios";
import "dotenv/config";

const prisma = new PrismaClient();

export async function uploadToImgBB(file) {
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
        throw new Error("Erro no upload para ImgBB");
    }
}

export async function createAddress(req, res, _next) {
    try {
        const createSchema = z.object({
            place: z.string()
                .min(3, "O endereço deve ter no mínimo 3 caracteres.")
                .regex(/^[a-zA-Z0-9À-ÿ\s,.\-]+$/, "O endereço possui caracteres especiais inválidos."),
            number: z.string()
                .min(1, "O número é obrigatório.")
                .regex(/^\d{1,6}(?:\s?[a-zA-Z])?$/, "O número deve ter até 6 números e no máximo uma letra (ex: 102 F ou 123 b)."),
            zipcode: z.string()
                .regex(/^\d{5}-?\d{3}$|^\d{8}$/, "CEP inválido. Use o formato 00000-000 ou 8 dígitos."),
            lat: z.preprocess((val) => parseFloat(val), z.number().min(-90, "Latitude inválida.").max(90, "Latitude inválida.")),
            long: z.preprocess((val) => parseFloat(val), z.number().min(-180, "Longitude inválida.").max(180, "Longitude inválida.")),
            url: z.string().url("URL de imagem inválida.").optional().or(z.literal('')),
            companyId: z.coerce.number().optional()
        });

        let imageUrl = req.body.url || "";
        if (req.file) {
            imageUrl = await uploadToImgBB(req.file);
        }

        const bodyToValidate = { ...req.body };
        if (imageUrl) bodyToValidate.url = imageUrl;

        const validation = createSchema.safeParse(bodyToValidate);

        if (!validation.success) {
            return res.status(400).json({
                error: "Dados de endereço inválidos.",
                detalhes: validation.error.format()
            });
        }

        const data = validation.data;
        const loggedId = req.logged?.id ? Number(req.logged.id) : null;

        const addressData = {
            place: data.place,
            number: data.number,
            zipcode: data.zipcode,
            lat: data.lat,
            long: data.long,
            url: data.url || "",
            ...(loggedId ? { users: { connect: [{ id: loggedId }] } } : {})
        };

        if (data.companyId) {
            const companyExists = await prisma.company.findUnique({ where: { id: data.companyId } });
            if (!companyExists) {
                return res.status(404).json({ error: "Empresa indicada no companyId não existe." });
            }
            addressData.addressCompany = {
                create: {
                    companyId: data.companyId
                }
            };
        }

        const address = await prisma.address.create({
            data: addressData,
            include: {
                addressCompany: true,
                users: true
            }
        });

        return res.status(201).json(address);
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}

export async function readAddress(req, res, _next) {
    try {
        const { lat, long, user, category, company, favorite, radius } = req.query;

        let consult = {};

        if (lat && long) {
            const latitude = parseFloat(lat);
            const longitude = parseFloat(long);

            if (isNaN(latitude) || isNaN(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
                return res.status(400).json({ error: "Latitude ou Longitude em formato inválido ou fora dos limites." });
            }

            const r = radius ? parseFloat(radius) : 0.05;

            consult = {
                lat: {
                    gte: latitude - r,
                    lte: latitude + r,
                },
                long: {
                    gte: longitude - r,
                    lte: longitude + r,
                },
            };
        } else if (lat) {
            const latitude = parseFloat(lat);
            if (isNaN(latitude)) return res.status(400).json({ error: "Latitude inválida." });
            consult.lat = { equals: latitude };
        } else if (long) {
            const longitude = parseFloat(long);
            if (isNaN(longitude)) return res.status(400).json({ error: "Longitude inválida." });
            consult.long = { equals: longitude };
        }

        if (user) {
            consult.users = { some: { id: parseInt(user) } };
        }

        if (company) {
            consult.addressCompany = { some: { companyId: parseInt(company) } };
        }

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
            };
        }

        if (favorite) {
            consult.addressCompany = {
                ...(consult.addressCompany || {}),
                some: {
                    ...(consult.addressCompany?.some || {}),
                    company: { favorites: { some: { userId: parseInt(favorite) } } }
                }
            };
        }

        const address = await prisma.address.findMany({
            where: consult,
            include: {
                addressCompany: true
            }
        });

        return res.status(200).json(address);
    } catch (error) {
        console.error("Erro ao ler endereços:", error);
        return res.status(500).json({ error: "Erro interno ao buscar endereços." });
    }
}

export async function showAddress(req, res, _next) {
    try {
        let id = Number(req.params.id);

        if (isNaN(id)) return res.status(400).json({ error: "ID de endereço inválido." });

        let a = await prisma.address.findUnique({
            where: { id: id },
            include: {
                addressCompany: true,
                users: true
            }
        });

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
        const loggedId = req.logged?.id ? Number(req.logged.id) : null;
        if (!loggedId) {
            return res.status(401).json({ error: "Autenticação obrigatória." });
        }

        let id = Number(req.params.id);
        if (isNaN(id)) return res.status(400).json({ error: "ID de endereço inválido." });

        const editSchema = z.object({
            place: z.string()
                .regex(/^[a-zA-Z0-9À-ÿ\s,.\-]+$/, "O endereço possui caracteres especiais inválidos.")
                .optional(),
            number: z.string()
                .regex(/^\d{1,6}(?:\s?[a-zA-Z])?$/, "O número deve ter até 6 números e no máximo uma letra (ex: 102 F ou 123 b).")
                .optional(),
            zipcode: z.string()
                .regex(/^\d{5}-?\d{3}$|^\d{8}$/, "CEP inválido. Use o formato 00000-000 ou 8 dígitos.")
                .optional(),
            lat: z.number().min(-90).max(90).optional(),
            long: z.number().min(-180).max(180).optional(),
            url: z.string().url("URL de imagem inválida.").optional().or(z.literal('')),
            companyId: z.coerce.number().optional()
        });

        let imageUrl = req.body.url;
        if (req.file) {
            imageUrl = await uploadToImgBB(req.file);
        }

        const bodyToValidate = { ...req.body };
        if (imageUrl !== undefined) bodyToValidate.url = imageUrl;

        const validation = editSchema.safeParse(bodyToValidate);

        if (!validation.success) {
            return res.status(400).json({
                error: "Dados de atualização inválidos.",
                detalhes: validation.error.format()
            });
        }

        const updateData = validation.data;

        const existingAddress = await prisma.address.findUnique({
            where: { id: id },
            include: { users: true, addressCompany: true }
        });

        if (!existingAddress) {
            return res.status(404).json({ error: `Endereço com id ${id} não existe e não pode ser editado.` });
        }

        const isOwner = existingAddress.users.some(user => user.id === loggedId);
        const isAdmin = req.logged.type === 'admin';

        if (!isOwner && !isAdmin) {
            return res.status(403).json({ error: "Acesso negado. Somente o dono deste endereço pode fazer alterações." });
        }

        const { companyId, ...fieldsToUpdate } = updateData;

        if (companyId) {
            const companyExists = await prisma.company.findUnique({ where: { id: companyId } });
            if (!companyExists) {
                return res.status(404).json({ error: "Empresa informada no companyId não existe." });
            }

            const existingLink = await prisma.addressCompany.findFirst({
                where: { addressId: id, companyId: companyId }
            });

            if (!existingLink) {
                await prisma.addressCompany.create({
                    data: {
                        addressId: id,
                        companyId: companyId
                    }
                });
            }
        }

        const updatedAddress = await prisma.address.update({
            where: { id: id },
            data: fieldsToUpdate,
            include: { addressCompany: true, users: true }
        });

        return res.status(202).json(updatedAddress);
    } catch (error) {
        console.error("Erro ao editar o endereço:", error);
        return res.status(500).json({ error: "Erro interno no servidor ao tentar editar o endereço." });
    }
}

export async function deleteAddress(req, res, _next) {
    try {
        const loggedId = req.logged?.id ? Number(req.logged.id) : null;
        if (!loggedId) {
            return res.status(401).json({ error: "Autenticação obrigatória." });
        }

        let id = Number(req.params.id);
        if (isNaN(id)) return res.status(400).json({ error: "ID de endereço inválido." });

        let d = await prisma.address.findUnique({
            where: { id: id },
            include: { users: true }
        });

        if (!d) {
            return res.status(404).json({ error: `Falha na exclusão: Endereço com id ${id} não encontrado.` });
        }

        const isOwner = d.users.some(user => user.id === loggedId);
        const isAdmin = req.logged.type === 'admin';

        if (!isOwner && !isAdmin) {
            return res.status(403).json({ error: "Acesso negado. Somente o dono deste endereço pode deletá-lo." });
        }

        // Deletar associações primeiro para não violar foreign keys
        await prisma.addressCompany.deleteMany({ where: { addressId: id } });
        await prisma.address.delete({ where: { id: id } });

        return res.status(200).json({ message: `Endereço com id ${id} deletado com sucesso.` });
    } catch (error) {
        console.error("Erro ao deletar o endereço:", error);
        return res.status(500).json({ error: "Erro interno ao tentar deletar o endereço." });
    }
}



