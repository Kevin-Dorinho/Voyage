import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import prisma from '../utils/prisma.js';
import { JWT_SECRET } from '../utils/config.js';
import { sanitizeUser, sanitizeUsers } from '../utils/sanitize.js';
import { attachSave } from "../utils/save.js";

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

const passwordSchema = z.string()
    .min(10, "Senha deve ter no mínimo 10 caracteres")
    .regex(/[A-Z]/, "Senha deve ter pelo menos uma letra maiúscula")
    .regex(/[^a-zA-Z0-9]/, "Senha deve ter pelo menos um símbolo")
    .refine((val) => !/12345|qwerty|password/i.test(val), "Senha muito fácil, contem sequencia obvia");

const nameSchema = z.string()
    .min(3, "Nome deve ter pelo menos 3 caracteres")
    .regex(/^[A-Za-zÀ-ÖØ-öø-ÿ\s'-]+$/, "Nome não deve conter números ou símbolos especiais");

// ─── Schema explícito para cadastro público ─────────────────────────
// Somente os campos permitidos são aceitos. Campos como id, signature,
// timestamps e relacionamentos são ignorados pelo schema.
const createUserSchema = z.object({
    name: nameSchema,
    email: z.string().email("E-mail com formato inválido"),
    password: passwordSchema,
    type: z.string({ required_error: "O campo 'type' é obrigatório" })
        .refine(
            (val) => ["client", "owner"].includes(val),
            { message: "No cadastro público, o tipo deve ser 'client' ou 'owner'. Contas admin não podem ser criadas por esta rota." }
        ),
    phone: z.string().regex(/^\+?[0-9\s()+-]{8,25}$/, "Telefone com formato inválido").optional(),
    cpf: cpfSchema.optional()
});


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
            JWT_SECRET,
            { expiresIn: '1d' }
        );

        return res.status(200).json({
            message: "Login realizado com sucesso",
            token: token,
            user: sanitizeUser(user)
        });
    } catch (error) {
        console.error("Error in loginUser:", error.message);
        return res.status(500).json({ error: "Internal server error" });
    }
}

//rec: requisição, do que está vindo do front end
//res: response ou responder, o que eu vou responder
//nest: próximo, o que eu vou fazer a seguir
export async function createUser(req, res, _next) {
    try {
        // Valida usando schema explícito — somente campos permitidos
        const validation = createUserSchema.safeParse(req.body);

        if (!validation.success) {
            const firstError = validation.error.issues[0];
            return res.status(400).json({ error: firstError.message });
        }

        const data = validation.data;

        // Verificar e-mail duplicado
        const emailInUse = await prisma.user.findFirst({ where: { email: data.email } });
        if (emailInUse) {
            return res.status(409).json({ error: "O e-mail informado já está em uso" });
        }

        // Hash da senha — o hash fica somente no servidor/banco
        data.password = await bcrypt.hash(data.password, 10);

        // Assinatura inicial vem da regra do servidor, não do cliente
        data.signature = 'BASIC';

        let u = await prisma.user.create({ data });

        const token = jwt.sign(
            { sub: u.id, type: u.type, email: u.email, name: u.name },
            JWT_SECRET,
            { expiresIn: '1d' }
        );

        return res.status(201).json({
            message: "Usuário criado com sucesso",
            token: token,
            user: sanitizeUser(u)
        });
    } catch (error) {
        console.error("Error in createUser:", error.message);
        return res.status(500).json({ error: "Erro interno no servidor" });
    }
}

export async function readUser(req, res, _next) {
    try {
        if (req.logged && req.logged.type !== 'admin') {
            return res.status(403).json({ error: "Acesso Negado. Apenas administradores do sistema podem listar os usuários." });
        }

        const { name, type, signature, email, phone, cpf } = req.query;

        let consult = {}
        if (name) consult.name = { contains: name }
        if (email) consult.email = { contains: email }
        if (type) consult.type = { contains: type }
        if (signature) consult.signature = { contains: signature }
        if (phone) consult.phone = { contains: phone }
        if (cpf) consult.cpf = { contains: cpf }

        let users = await prisma.user.findMany({ where: consult });

        return res.status(200).json(sanitizeUsers(users));
    } catch (error) {
        console.error("Error in readUser:", error.message);
        return res.status(500).json({ error: "Erro interno no servidor" });
    }
}

export async function showUser(req, res, _next) {
    try {
        let id = Number(req.params.id);
        if (isNaN(id)) {
            return res.status(400).json({ error: "Invalid ID format" });
        }

        if (req.logged && req.logged.id !== id && req.logged.type !== 'admin') {
            return res.status(403).json({ error: "Acesso Negado. Você só pode acessar o seu próprio perfil." });
        }

        let u = await prisma.user.findFirst({ where: { id: id } });
        if (!u) {
            return res.status(404).json({ error: "User not found" });
        }

        return res.status(200).json(sanitizeUser(u));
    } catch (error) {
        console.error("Error in showUser:", error.message);
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

        // ─── Bloqueio de campos protegidos ─────────────────────────
        // type e signature não podem ser alterados pelo fluxo de perfil.
        // Tentativas retornam erro claro em vez de serem ignoradas.
        if (type !== undefined) {
            return res.status(403).json({
                error: "O campo 'type' não pode ser alterado pelo perfil. A alteração de cargo requer um procedimento administrativo restrito."
            });
        }
        if (signature !== undefined) {
            return res.status(403).json({
                error: "O campo 'signature' não pode ser alterado pelo perfil. A alteração de assinatura requer um procedimento específico."
            });
        }

        // --- AUTH: DO SERVICE PARA O BANCO ---
        // Usa o contexto da Auth injetado na req para aplicar segurança granular na camada do Prisma (Banco)
        if (req.logged && req.logged.id !== id && req.logged.type !== 'admin') {
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
        if (phone) u.phone = phone;
        if (cpf) u.cpf = cpf;
        if (password) u.password = await bcrypt.hash(password, 10);

        await u.save();

        return res.status(202).json(sanitizeUser(u));
    } catch (error) {
        console.error("Error in editUser:", error.message);
        return res.status(500).json({ error: "Internal server error" });
    }
}
