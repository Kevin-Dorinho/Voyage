import { PrismaClient } from "@prisma/client";
import { z } from 'zod';
import { attachSave } from "../utils/save.js";
const prisma = new PrismaClient();

const cpfSchema = z.string().refine((cpf) => {
    cpf = cpf.replace(/[^\d]+/g, '');
    if (cpf.length !== 11 || /^(\d)\1+$/.test(cpf)) return false;
    let sum = 0, remainder;
    for (let i = 1; i <= 9; i++) sum += parseInt(cpf.substring(i - 1, i)) * (11 - i);
    remainder = (sum * 10) % 11;
    if (remainder === 10 || remainder === 11) remainder = 0;
    if (remainder !== parseInt(cpf.substring(9, 10))) return false;
    sum = 0;
    for (let i = 1; i <= 10; i++) sum += parseInt(cpf.substring(i - 1, i)) * (12 - i);
    remainder = (sum * 10) % 11;
    if (remainder === 10 || remainder === 11) remainder = 0;
    if (remainder !== parseInt(cpf.substring(10, 11))) return false;
    return true;
});

const typeSchema = z.enum(["client", "owner"]);
const passwordSchema = z.string()
    .min(10, "Senha deve ter no mínimo 10 caracteres")
    .regex(/[A-Z]/, "Senha deve ter pelo menos uma letra maiúscula")
    .regex(/[^a-zA-Z0-9]/, "Senha deve ter pelo menos um símbolo")
    .refine((val) => !/12345|qwerty|password/i.test(val), "Senha muito fácil, contem sequencia obvia");

const nameSchema = z.string()
    .min(3, "Nome deve ter pelo menos 3 caracteres")
    .regex(/^[A-Za-zÀ-ÖØ-öø-ÿ\s'-]+$/, "Nome não deve conter números ou símbolos especiais");

//rec: requisição, o que está vindo do front end
//res: response ou responder, o que eu vou responder
//nest: próximo, o que eu vou fazer a seguir
export async function createUser(req, res, _next) {
    try {
        const data = req.body;

        if (data.email) {
            const emailResult = z.string().email().safeParse(data.email);
            if (!emailResult.success) {
                return res.status(400).json({ error: "E-mail com formato inválido" });
            }
        }
        if (data.phone) {
            const phoneResult = z.string().regex(/^\+?[0-9\s()+-]{8,25}$/).safeParse(data.phone);
            if (!phoneResult.success) {
                return res.status(400).json({ error: "Telefone com formato inválido" });
            }
        }
        if (data.cpf) {
            const cpfResult = cpfSchema.safeParse(data.cpf);
            if (!cpfResult.success) {
                return res.status(400).json({ error: "CPF inválido" });
            }
        }
        if (data.type) {
            const typeResult = typeSchema.safeParse(data.type);
            if (!typeResult.success) {
                return res.status(400).json({ error: "Tipo deve ser 'client' ou 'owner'" });
            }
        }
        if (data.password) {
            const passResult = passwordSchema.safeParse(data.password);
            if (!passResult.success) {
                const errorMsg = passResult.error?.issues?.[0]?.message || passResult.error?.errors?.[0]?.message || "Senha inválida";
                return res.status(400).json({ error: errorMsg });
            }
        }
        if (data.name) {
            const nameResult = nameSchema.safeParse(data.name);
            if (!nameResult.success) {
                const errorMsg = nameResult.error?.issues?.[0]?.message || nameResult.error?.errors?.[0]?.message || "Nome com formato inválido";
                return res.status(400).json({ error: errorMsg });
            }
        }

        if (data.email) {
            const emailInUse = await prisma.user.findFirst({ where: { email: data.email } });
            if (emailInUse) {
                return res.status(409).json({ error: "O e-mail informado já está em uso" });
            }
        }

        let u = await prisma.user.create({ data });
        return res.status(201).json(u);
    } catch (error) {
        console.error("Error in createUser:", error);
        return res.status(500).json({ error: error.message });
    }
}

export async function readUser(req, res, _next) {
    try {
        const { name, type, signature, email, phone, cpf } = req.query;

        let consult = {}
        if (name) consult.name = { contains: "%" + name + "%" }
        if (email) consult.email = { contains: "%" + email + "%" }
        if (type) consult.type = { contains: "%" + type + "%" }
        if (signature) consult.signature = { contains: "%" + signature + "%" }
        if (phone) consult.phone = { contains: "%" + phone + "%" }
        if (cpf) consult.cpf = { contains: "%" + cpf + "%" }

        let users = await prisma.user.findMany({ where: consult });

        return res.status(200).json(users);
    } catch (error) {
        console.error("Error in readUser:", error);
        return res.status(500).json({ error: error.message });
    }
}

export async function showUser(req, res, _next) {
    try {
        let id = Number(req.params.id);
        if (isNaN(id)) {
            return res.status(400).json({ error: "Invalid ID format" });
        }

        let u = await prisma.user.findFirst({ where: { id: id } });
        if (!u) {
            return res.status(404).json({ error: "User not found" });
        }

        return res.status(200).json(u);
    } catch (error) {
        console.error("Error in showUser:", error);
        return res.status(500).json({ error: "Internal server error" });
    }
}

export async function editUser(req, res, _next) {
    try {
        let id = Number(req.params.id);
        if (isNaN(id)) {
            return res.status(400).json({ error: "Invalid ID format" });
        }

        const { name, type, signature, email, phone, cpf, password } = req.body;

        // --- AUTH: DO SERVICE PARA O BANCO ---
        // Usa o contexto da Auth injetado na req para aplicar segurança granular na camada do Prisma (Banco)
        if (req.user && req.user.id !== id && req.user.type !== 'owner') {
            return res.status(403).json({ error: "Acesso DB Negado. Você não tem permissão para editar este usuário." });
        }

        let u = await prisma.user.findFirst({ where: { id: id } });

        if (!u) {
            return res.status(404).json({ error: "Not found " + id });
        }

        if (email) {
            const emailResult = z.string().email().safeParse(email);
            if (!emailResult.success) {
                return res.status(400).json({ error: "E-mail com formato inválido" });
            }

            const emailInUse = await prisma.user.findFirst({ where: { email: email, id: { not: id } } });
            if (emailInUse) {
                return res.status(409).json({ error: "O e-mail informado já está em uso" });
            }
        }
        if (phone) {
            const phoneResult = z.string().regex(/^\+?[0-9\s()+-]{8,25}$/).safeParse(phone);
            if (!phoneResult.success) {
                return res.status(400).json({ error: "Telefone com formato inválido" });
            }
        }
        if (cpf) {
            const cpfResult = cpfSchema.safeParse(cpf);
            if (!cpfResult.success) {
                return res.status(400).json({ error: "CPF inválido" });
            }
        }
        if (type) {
            const typeResult = typeSchema.safeParse(type);
            if (!typeResult.success) {
                return res.status(400).json({ error: "Tipo deve ser 'client' ou 'owner'" });
            }
        }
        if (password) {
            const passResult = passwordSchema.safeParse(password);
            if (!passResult.success) {
                const errorMsg = passResult.error?.issues?.[0]?.message || passResult.error?.errors?.[0]?.message || "Senha inválida";
                return res.status(400).json({ error: errorMsg });
            }
        }
        if (name) {
            const nameResult = nameSchema.safeParse(name);
            if (!nameResult.success) {
                const errorMsg = nameResult.error?.issues?.[0]?.message || nameResult.error?.errors?.[0]?.message || "Nome com formato inválido";
                return res.status(400).json({ error: errorMsg });
            }
        }

        u = attachSave(u, 'user');

        if (name) u.name = name;
        if (email) u.email = email;
        if (type) u.type = type;
        if (signature) u.signature = signature;
        if (phone) u.phone = phone;
        if (cpf) u.cpf = cpf;
        if (password) u.password = password;

        await u.save();

        return res.status(202).json(u);
    } catch (error) {
        console.error("Error in editUser:", error);
        return res.status(500).json({ error: "Internal server error" });
    }
}

