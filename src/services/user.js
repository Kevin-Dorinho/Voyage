import { PrismaClient } from "@prisma/client";
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { attachSave } from "../utils/save.js";

const prisma = new PrismaClient();
const SECRET_KEY = process.env.JWT_SECRET || 'voyage_default_dev_secret';

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

const publicTypeSchema = z.enum(["client", "owner"]);
const allTypeSchema = z.enum(["client", "owner", "admin"]);

const passwordSchema = z.string()
    .min(10, "Senha deve ter no mínimo 10 caracteres")
    .regex(/[A-Z]/, "Senha deve ter pelo menos uma letra maiúscula")
    .regex(/[^a-zA-Z0-9]/, "Senha deve ter pelo menos um símbolo")
    .refine((val) => !/12345|qwerty|password/i.test(val), "Senha muito fácil, contem sequencia obvia");

const nameSchema = z.string()
    .min(3, "Nome deve ter pelo menos 3 caracteres")
    .regex(/^[A-Za-zÀ-ÖØ-öø-ÿ\s'-]+$/, "Nome não deve conter números ou símbolos especiais");

function sanitizeUser(user) {
    if (!user) return null;
    const { password, ...safeUser } = user;
    return safeUser;
}

export async function loginUser(req, res, _next) {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: "E-mail e senha são obrigatórios" });
        }

        const user = await prisma.user.findFirst({ where: { email: email } });

        if (!user) {
            return res.status(401).json({ error: "Email ou senha incorretos" });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ error: "Email ou senha incorretos" });
        }

        const token = jwt.sign(
            { sub: user.id, type: user.type, email: user.email, name: user.name },
            SECRET_KEY,
            { expiresIn: '1d' }
        );

        return res.status(200).json({
            message: "Login realizado com sucesso",
            token: token,
            user: { id: user.id, name: user.name, type: user.type, email: user.email }
        });
    } catch (error) {
        console.error("Error in loginUser:", error);
        return res.status(500).json({ error: "Internal server error" });
    }
}

export async function createUser(req, res, _next) {
    try {
        const body = req.body || {};

        const emailResult = z.string().email("E-mail com formato inválido").safeParse(body.email);
        if (!emailResult.success) {
            return res.status(400).json({ error: "E-mail com formato inválido" });
        }

        const passResult = passwordSchema.safeParse(body.password);
        if (!passResult.success) {
            const errorMsg = passResult.error?.issues?.[0]?.message || "Senha inválida";
            return res.status(400).json({ error: errorMsg });
        }

        const nameResult = nameSchema.safeParse(body.name);
        if (!nameResult.success) {
            const errorMsg = nameResult.error?.issues?.[0]?.message || "Nome com formato inválido";
            return res.status(400).json({ error: errorMsg });
        }

        let userType = "client";
        if (body.type) {
            const typeResult = publicTypeSchema.safeParse(body.type);
            if (!typeResult.success) {
                return res.status(400).json({ error: "Tipo deve ser 'client' ou 'owner' no cadastro público" });
            }
            userType = body.type;
        }

        if (body.phone) {
            const phoneResult = z.string().regex(/^\+?[0-9\s()+-]{8,25}$/).safeParse(body.phone);
            if (!phoneResult.success) {
                return res.status(400).json({ error: "Telefone com formato inválido" });
            }
        }

        if (body.cpf) {
            const cpfResult = cpfSchema.safeParse(body.cpf);
            if (!cpfResult.success) {
                return res.status(400).json({ error: "CPF inválido" });
            }
        }

        const emailInUse = await prisma.user.findFirst({ where: { email: body.email } });
        if (emailInUse) {
            return res.status(409).json({ error: "O e-mail informado já está em uso" });
        }

        const hashedPassword = await bcrypt.hash(body.password, 10);

        const dataToSave = {
            name: body.name,
            email: body.email,
            password: hashedPassword,
            type: userType,
            phone: body.phone || null,
            cpf: body.cpf || null
        };

        const u = await prisma.user.create({ data: dataToSave });

        const token = jwt.sign(
            { sub: u.id, type: u.type, email: u.email, name: u.name },
            SECRET_KEY,
            { expiresIn: '1d' }
        );

        return res.status(201).json({
            message: "Usuário criado com sucesso",
            token: token,
            user: sanitizeUser(u)
        });
    } catch (error) {
        console.error("Error in createUser:", error);
        return res.status(500).json({ error: error.message });
    }
}

export async function readUser(req, res, _next) {
    try {
        if (!req.logged) {
            return res.status(401).json({ error: "Autenticação obrigatória" });
        }

        if (req.logged.type !== 'admin') {
            return res.status(403).json({ error: "Acesso Negado. Apenas administradores do sistema podem listar os usuários." });
        }

        const { name, type, signature, email, phone, cpf } = req.query;

        let consult = {};
        if (name) consult.name = { contains: name };
        if (email) consult.email = { contains: email };
        if (type) consult.type = { contains: type };
        if (signature) consult.signature = { contains: signature };
        if (phone) consult.phone = { contains: phone };
        if (cpf) consult.cpf = { contains: cpf };

        const users = await prisma.user.findMany({ where: consult });

        return res.status(200).json(users.map(sanitizeUser));
    } catch (error) {
        console.error("Error in readUser:", error);
        return res.status(500).json({ error: error.message });
    }
}

export async function showUser(req, res, _next) {
    try {
        if (!req.logged) {
            return res.status(401).json({ error: "Autenticação obrigatória" });
        }

        let id = Number(req.params.id);
        if (isNaN(id)) {
            return res.status(400).json({ error: "Invalid ID format" });
        }

        if (req.logged.id !== id && req.logged.type !== 'admin') {
            return res.status(403).json({ error: "Acesso Negado. Você só pode acessar o seu próprio perfil." });
        }

        let u = await prisma.user.findFirst({ where: { id: id } });
        if (!u) {
            return res.status(404).json({ error: "User not found" });
        }

        return res.status(200).json(sanitizeUser(u));
    } catch (error) {
        console.error("Error in showUser:", error);
        return res.status(500).json({ error: "Internal server error" });
    }
}

export async function editUser(req, res, _next) {
    try {
        if (!req.logged) {
            return res.status(401).json({ error: "Autenticação obrigatória" });
        }

        let id = Number(req.params.id);
        if (isNaN(id)) {
            return res.status(400).json({ error: "Invalid ID format" });
        }

        if (req.logged.id !== id && req.logged.type !== 'admin') {
            return res.status(403).json({ error: "Acesso DB Negado. Você não tem permissão para editar este usuário." });
        }

        const { name, type, signature, email, phone, cpf, password } = req.body;

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
            const typeResult = allTypeSchema.safeParse(type);
            if (!typeResult.success) {
                return res.status(400).json({ error: "Tipo deve ser 'client', 'owner' ou 'admin'" });
            }
            if (req.logged.type !== 'admin' && type !== u.type) {
                return res.status(403).json({ error: "Apenas administradores podem alterar o tipo de um usuário" });
            }
        }
        if (password) {
            const passResult = passwordSchema.safeParse(password);
            if (!passResult.success) {
                const errorMsg = passResult.error?.issues?.[0]?.message || "Senha inválida";
                return res.status(400).json({ error: errorMsg });
            }
        }
        if (name) {
            const nameResult = nameSchema.safeParse(name);
            if (!nameResult.success) {
                const errorMsg = nameResult.error?.issues?.[0]?.message || "Nome com formato inválido";
                return res.status(400).json({ error: errorMsg });
            }
        }

        u = attachSave(u, 'user');

        if (name) u.name = name;
        if (email) u.email = email;
        if (type && req.logged.type === 'admin') u.type = type;
        if (signature) u.signature = signature;
        if (phone) u.phone = phone;
        if (cpf) u.cpf = cpf;
        if (password) u.password = await bcrypt.hash(password, 10);

        await u.save();

        return res.status(202).json(sanitizeUser(u));
    } catch (error) {
        console.error("Error in editUser:", error);
        return res.status(500).json({ error: "Internal server error" });
    }
}


