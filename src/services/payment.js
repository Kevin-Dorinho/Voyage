import { z } from 'zod';
import prisma from '../utils/prisma.js';
import { attachSave } from "../utils/save.js";

// Função centralizada para tratamento de erros
function handleErrors(error, res) {
    // Tratamento para Erros de Validação dos Dados Formatados (Zod)
    if (error && error.name === 'ZodError') {

        const rawErrors = error.errors || error.issues || [];
        const errorsList = rawErrors.map(err => {
            let dica = "Revise o formato dessa informação.";
            if (err.code === "invalid_type") {
                dica = `O tipo inserido está incorreto. O sistema esperava um '${err.expected}' (Exemplo: número sem aspas), mas recebeu um '${err.received}' (Texto/String com aspas). Remova as aspas se for número.`;
            } else if (err.code === "invalid_date") {
                dica = "Siga estritamente o modelo de formatação de datas: Exemplo 2026-02-26T00:00:00Z";
            } else if (err.code === "too_small" && err.type === "string") {
                dica = "Este texto não pode ser preenchido em branco.";
            }

            return {
                informacaoErradaNoCampo: err.path.join('.'),
                mensagemDoSistema: err.message,
                instrucaoParaCorrigir: dica
            };
        });
        return res.status(400).json({
            error: rawErrors[0]?.message || "Você preencheu informações em formato incorreto. O sistema recusou o cadastro.",
            erroPrincipal: "Você preencheu informações em formato incorreto. O sistema recusou o cadastro.",
            solucoesDetalhadas: errorsList
        });
    }

    // Erros Genéricos de Falta de Formato no Banco Prisma
    if (error && error.name === 'PrismaClientValidationError') {
        return res.status(400).json({
            erroPrincipal: "Erro de Tipagem Estrutural",
            instrucaoParaCorrigir: "Você enviou um dado numérico como texto ou falta preencher algum campo. Valide que todos os números no JSON não estejam entre aspas."
        });
    }

    // Erro de FK (A empresa informada não existe ainda)
    if (error && error.code === 'P2003') {
        return res.status(400).json({
            erroPrincipal: "Empresa não cadastrada no sistema",
            mensagemDoSistema: "Falha de relacionamento de chaves (Foreign Key).",
            instrucaoParaCorrigir: "Confirme se o campo companyId está correto. A empresa associada a esse pagamento precisa ser salva/criada no banco antes de mandar o pagamento!"
        });
    }

    // Erro Não Encontrado do Banco
    if (error && error.code === 'P2025') {
        return res.status(404).json({
            erroPrincipal: "Registro não encontrado para Ação",
            mensagemDoSistema: "Não localizamos ninguém com esse ID.",
            instrucaoParaCorrigir: "Verifique o número que você colocou na URL."
        });
    }

    // Default de Sobra — sem expor detalhes internos
    return res.status(500).json({
        erroPrincipal: "O Servidor identificou um erro interno",
        instrucaoParaCorrigir: "Contacte seu suporte."
    });
}

// ─── Helpers de autorização ──────────────────────────────────────────

/**
 * Retorna os IDs das empresas que pertencem ao usuário logado.
 */
async function getOwnerCompanyIds(userId) {
    const companies = await prisma.company.findMany({
        where: { userId: Number(userId) },
        select: { id: true }
    });
    return companies.map(c => c.id);
}

/**
 * Verifica se o usuário logado tem acesso à empresa especificada.
 * Admin tem acesso a todas; owner apenas às próprias; client não tem acesso.
 * Retorna { allowed, error?, status? }
 */
async function checkCompanyAccess(req, companyId) {
    if (!req.logged) {
        return { allowed: false, status: 401, error: "Autenticação necessária." };
    }

    // Clients não acessam o módulo de pagamentos
    if (req.logged.type === 'client') {
        return { allowed: false, status: 403, error: "Acesso negado. Clientes não têm acesso ao módulo de pagamentos." };
    }

    // Admin tem acesso a todas as empresas
    if (req.logged.type === 'admin') {
        return { allowed: true };
    }

    // Owner — verificar se a empresa pertence a ele
    const company = await prisma.company.findFirst({
        where: { id: companyId, userId: Number(req.logged.id) }
    });

    if (!company) {
        return { allowed: false, status: 403, error: "Acesso negado. Você não tem permissão sobre essa empresa." };
    }

    return { allowed: true };
}

/**
 * Valida e resolve o companyId para criação de pagamento.
 * - Owner sem companyId: usa sua única empresa; se houver várias, exige seleção.
 * - Owner com companyId: valida existência e propriedade.
 * - Admin: deve informar companyId; valida existência.
 * Retorna { companyId?, error?, status? }
 */
async function resolveCompanyForCreate(req) {
    if (!req.logged) {
        return { error: "Autenticação necessária.", status: 401 };
    }

    if (req.logged.type === 'client') {
        return { error: "Acesso negado. Clientes não têm acesso ao módulo de pagamentos.", status: 403 };
    }

    const bodyCompanyId = req.body.companyId ? Number(req.body.companyId) : null;

    if (bodyCompanyId !== null && (!Number.isInteger(bodyCompanyId) || bodyCompanyId <= 0)) {
        return { error: "companyId deve ser um número inteiro positivo.", status: 400 };
    }

    if (req.logged.type === 'admin') {
        if (!bodyCompanyId) {
            return { error: "Admin deve informar o companyId ao criar um pagamento.", status: 400 };
        }
        // Valida que a empresa existe
        const company = await prisma.company.findFirst({ where: { id: bodyCompanyId } });
        if (!company) {
            return { error: `Empresa com id ${bodyCompanyId} não encontrada.`, status: 404 };
        }
        return { companyId: bodyCompanyId };
    }

    // Owner
    if (bodyCompanyId) {
        // Valida que a empresa existe E pertence ao owner
        const company = await prisma.company.findFirst({
            where: { id: bodyCompanyId, userId: Number(req.logged.id) }
        });
        if (!company) {
            return { error: "Empresa não encontrada ou não pertence a você.", status: 403 };
        }
        return { companyId: bodyCompanyId };
    }

    // Owner sem companyId — inferir empresa
    const ownerCompanies = await prisma.company.findMany({
        where: { userId: Number(req.logged.id) },
        select: { id: true }
    });

    if (ownerCompanies.length === 0) {
        return { error: "Você não possui nenhuma empresa cadastrada. Crie uma empresa antes de registrar pagamentos.", status: 400 };
    }

    if (ownerCompanies.length > 1) {
        return { error: "Você possui mais de uma empresa. Informe o campo companyId para selecionar qual empresa.", status: 400 };
    }

    return { companyId: ownerCompanies[0].id };
}

// Schemas blindados para as Regras de Negócios
const createPaymentSchema = z.object({
    toDate: z.coerce.date({ required_error: "Data Inicial toDate ausente", invalid_type_error: "toDate deve ter formato válido como 2026-02-28 00:00:00Z" }),
    dueDate: z.coerce.date({ required_error: "Data Final dueDate ausente", invalid_type_error: "dueDate deve ter formato válido" }),
    paymentForm: z.string({ required_error: "paymentForm está ausente", invalid_type_error: "paymentForm precisa ser escrito entre aspas" }).min(1, "Não aceita forms vazios"),
    advertising: z.string({ required_error: "advertising está ausente", invalid_type_error: "advertising precisa ser escrito entre aspas" }).min(1),
    key: z.string({ required_error: "Falha, a key não foi passada" }).min(1),
    type: z.string({ required_error: "Falha, não indicou type" }).min(1)
}).refine((data) => data.dueDate >= data.toDate, {
    message: "A data de vencimento (dueDate) não pode ser anterior à data inicial (toDate).",
    path: ["dueDate"]
});

const editPaymentSchema = z.object({
    toDate: z.coerce.date({ invalid_type_error: "toDate deve ter formato válido" }).optional(),
    dueDate: z.coerce.date({ invalid_type_error: "dueDate deve ter formato válido" }).optional(),
    paymentForm: z.string().min(1, "Não aceita forms vazios").optional(),
    advertising: z.string().min(1).optional(),
    key: z.string().min(1).optional(),
    type: z.string().min(1).optional()
}).refine((data) => {
    if (data.toDate && data.dueDate) {
        return data.dueDate >= data.toDate;
    }
    return true;
}, {
    message: "A data de vencimento (dueDate) não pode ser anterior à data inicial (toDate).",
    path: ["dueDate"]
});

export async function createPayment(req, res, _next) {
    try {
        // Resolver empresa com verificação de autorização
        const resolved = await resolveCompanyForCreate(req);
        if (resolved.error) {
            return res.status(resolved.status).json({ error: resolved.error });
        }

        // Validar dados do pagamento
        const data = createPaymentSchema.parse(req.body);
        data.companyId = resolved.companyId;

        let p = await prisma.payment.create({ data });
        return res.status(201).json(p);
    } catch (error) {
        console.error("Error in createPayment:", error.message);
        return handleErrors(error, res);
    }
}

export async function readPayment(req, res, _next) {
    try {
        if (!req.logged) {
            return res.status(401).json({ error: "Autenticação necessária." });
        }

        // Clients não acessam o módulo de pagamentos
        if (req.logged.type === 'client') {
            return res.status(403).json({ error: "Acesso negado. Clientes não têm acesso ao módulo de pagamentos." });
        }

        const { companyId, to_date, due_date, paymentForm, advertising, type } = req.query;

        let consult = {};

        // ─── Filtro de propriedade no servidor ────────────────────
        if (req.logged.type === 'owner') {
            const ownerCompanyIds = await getOwnerCompanyIds(req.logged.id);

            if (ownerCompanyIds.length === 0) {
                return res.status(200).json([]); // Sem empresas = sem pagamentos
            }

            // Se o owner passou um companyId, verificar que é dele
            if (companyId) {
                let numId = Number(companyId);
                if (isNaN(numId) || !Number.isInteger(numId) || numId <= 0) {
                    return res.status(400).json({ error: "companyId deve ser um número inteiro positivo." });
                }
                if (!ownerCompanyIds.includes(numId)) {
                    return res.status(403).json({ error: "Acesso negado. Essa empresa não pertence a você." });
                }
                consult.companyId = numId;
            } else {
                // Sem filtro explícito: mostrar apenas das empresas do owner
                consult.companyId = { in: ownerCompanyIds };
            }
        } else if (req.logged.type === 'admin') {
            // Admin pode filtrar por qualquer empresa
            if (companyId) {
                let numId = Number(companyId);
                if (isNaN(numId) || !Number.isInteger(numId) || numId <= 0) {
                    return res.status(400).json({ error: "companyId deve ser um número inteiro positivo." });
                }
                consult.companyId = numId;
            }
        }

        // Suporta tanto to_date / due_date quanto toDate / dueDate
        const queryToDate = to_date || req.query.toDate;
        const queryDueDate = due_date || req.query.dueDate;

        let parsedToDate = null;
        let parsedDueDate = null;

        if (queryToDate) {
            parsedToDate = new Date(queryToDate);
            if (isNaN(parsedToDate.getTime())) {
                return res.status(400).json({ error: "Data inicial (to_date) em formato inválido." });
            }
        }

        if (queryDueDate) {
            parsedDueDate = new Date(queryDueDate);
            if (isNaN(parsedDueDate.getTime())) {
                return res.status(400).json({ error: "Data final (due_date) em formato inválido." });
            }
        }

        if (parsedToDate && parsedDueDate) {
            if (parsedToDate > parsedDueDate) {
                return res.status(400).json({ error: "A data inicial (to_date) não pode ser posterior à data final (due_date)." });
            }
            consult.toDate = { gte: parsedToDate };
            consult.dueDate = { lte: parsedDueDate };
        } else if (parsedToDate) {
            consult.toDate = { gte: parsedToDate };
        } else if (parsedDueDate) {
            consult.dueDate = { lte: parsedDueDate };
        }

        if (paymentForm) consult.paymentForm = { contains: paymentForm };
        if (advertising) consult.advertising = { contains: advertising };
        if (type) consult.type = { contains: type };

        let payments = await prisma.payment.findMany({ where: consult });
        return res.status(200).json(payments);
    } catch (error) {
        console.error("Error in readPayment:", error.message);
        return handleErrors(error, res);
    }
}

export async function showPayment(req, res, _next) {
    try {
        let id = Number(req.params.id);
        if (isNaN(id) || !Number.isInteger(id) || id <= 0) {
            return res.status(400).json({ error: "O ID do pagamento deve ser um número inteiro positivo." });
        }

        let p = await prisma.payment.findFirst({ where: { id: id } });
        if (!p) {
            return res.status(404).json({ error: "Pagamento não encontrado." });
        }

        // Verificar autorização sobre a empresa do pagamento
        const access = await checkCompanyAccess(req, p.companyId);
        if (!access.allowed) {
            return res.status(access.status).json({ error: access.error });
        }

        return res.status(200).json(p);
    } catch (error) {
        console.error("Error in showPayment:", error.message);
        return handleErrors(error, res);
    }
}

export async function editPayment(req, res, _next) {
    try {
        let id = Number(req.params.id);
        if (isNaN(id) || !Number.isInteger(id) || id <= 0) {
            return res.status(400).json({ error: "O ID do pagamento deve ser um número inteiro positivo." });
        }

        // Validar dados com o schema — usa os campos corretos (toDate, dueDate)
        const validatedData = editPaymentSchema.parse(req.body);

        // Não permitir trocar a empresa de um pagamento
        if (req.body.companyId !== undefined) {
            return res.status(400).json({ error: "Não é permitido alterar a empresa de um pagamento existente." });
        }

        let p = await prisma.payment.findFirst({ where: { id: id } });

        if (!p) {
            return res.status(404).json({ error: "Pagamento não encontrado." });
        }

        // Verificar autorização sobre a empresa do pagamento
        const access = await checkCompanyAccess(req, p.companyId);
        if (!access.allowed) {
            return res.status(access.status).json({ error: access.error });
        }

        const finalToDate = validatedData.toDate || p.toDate;
        const finalDueDate = validatedData.dueDate || p.dueDate;
        if (finalToDate && finalDueDate && new Date(finalDueDate) < new Date(finalToDate)) {
            return res.status(400).json({ error: "A data de vencimento (dueDate) não pode ser anterior à data inicial (toDate)." });
        }

        p = attachSave(p, 'payment');

        // Usar dados VALIDADOS pelo schema (toDate/dueDate, não to_date/due_date)
        if (validatedData.toDate) p.toDate = validatedData.toDate;
        if (validatedData.dueDate) p.dueDate = validatedData.dueDate;
        if (validatedData.paymentForm) p.paymentForm = validatedData.paymentForm;
        if (validatedData.advertising) p.advertising = validatedData.advertising;
        if (validatedData.key) p.key = validatedData.key;
        if (validatedData.type) p.type = validatedData.type;

        await p.save();
        return res.status(202).json(p);
    } catch (error) {
        console.error("Error in editPayment:", error.message);
        return handleErrors(error, res);
    }
}

export async function deletePayment(req, res, _next) {
    try {
        let id = Number(req.params.id);
        if (isNaN(id) || !Number.isInteger(id) || id <= 0) {
            return res.status(400).json({ error: "O ID do pagamento deve ser um número inteiro positivo." });
        }

        let p = await prisma.payment.findFirst({ where: { id: id } });

        if (!p) {
            return res.status(404).json({ error: "Pagamento não encontrado." });
        }

        // Verificar autorização sobre a empresa do pagamento
        const access = await checkCompanyAccess(req, p.companyId);
        if (!access.allowed) {
            return res.status(access.status).json({ error: access.error });
        }

        await prisma.payment.delete({ where: { id: id } });
        return res.status(200).json({ message: "Pagamento deletado com sucesso." });
    } catch (error) {
        console.error("Error in deletePayment:", error.message);
        return handleErrors(error, res);
    }
}