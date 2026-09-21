import { PrismaClient } from "@prisma/client";
import { z } from 'zod';
import { attachSave } from "../utils/save.js";

const prisma = new PrismaClient();

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
            erroPrincipal: "Você preencheu informações em formato incorreto. O sistema recusou o cadastro.",
            solucoesDetalhadas: errorsList
        });
    }

    // Erros Genéricos de Falta de Formato no Banco Prisma
    if (error && error.name === 'PrismaClientValidationError') {
        return res.status(400).json({
            erroPrincipal: "Erro de Tipagem Estrutural",
            mensagemDoSistema: error.message,
            instrucaoParaCorrigir: "Você enviou um dado numérico como texto (ex: colocou \"20\" no meio de aspas onde não devia), ou falta preencher algum campo. Valide que todos os números no JSON não estejam entre aspas."
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

    // Default de Sobra
    return res.status(500).json({
        erroPrincipal: "O Servidor identificou um erro fatal",
        mensagemDoSistema: error ? error.message : "Desconhecido",
        instrucaoParaCorrigir: "Contacte seu suporte."
    });
}

// Schemas blindados para as Regras de Negócios
const createPaymentSchema = z.object({
    companyId: z.coerce.number().optional(),
    toDate: z.coerce.date({ required_error: "Data Inicial toDate ausente", invalid_type_error: "toDate deve ter formato válido como 2026-02-28 00:00:00Z" }),
    dueDate: z.coerce.date({ required_error: "Data Final dueDate ausente", invalid_type_error: "dueDate deve ter formato válido" }),
    paymentForm: z.string({ required_error: "paymentForm está ausente", invalid_type_error: "paymentForm precisa ser escrito entre aspas" }).min(1, "Não aceita forms vazios"),
    advertising: z.string({ required_error: "advertising está ausente", invalid_type_error: "advertising precisa ser escrito entre aspas" }).min(1),
    key: z.string({ required_error: "Falha, a key não foi passada" }).min(1),
    type: z.string({ required_error: "Falha, não indicou type" }).min(1)
});

const editPaymentSchema = z.object({
    toDate: z.coerce.date({ invalid_type_error: "toDate deve ter formato válido" }).optional(),
    dueDate: z.coerce.date({ invalid_type_error: "dueDate deve ter formato válido" }).optional(),
    paymentForm: z.string().min(1).optional(),
    advertising: z.string().min(1).optional(),
    key: z.string().min(1).optional(),
    type: z.string().min(1).optional()
});

async function canAccessPayment(paymentId, loggedUser) {
    if (!loggedUser) return { allowed: false, errorStatus: 401, errorMsg: "Autenticação obrigatória." };
    if (loggedUser.type === 'admin') return { allowed: true };

    const payment = await prisma.payment.findUnique({
        where: { id: paymentId },
        include: { company: true }
    });

    if (!payment) return { allowed: false, errorStatus: 404, errorMsg: "Pagamento não encontrado." };

    if (payment.company.userId !== Number(loggedUser.id)) {
        return { allowed: false, errorStatus: 403, errorMsg: "Acesso negado. Este pagamento não pertence a uma de suas empresas." };
    }

    return { allowed: true, payment };
}

export async function createPayment(req, res, _next) {
    try {
        if (!req.logged) {
            return res.status(401).json({ error: "Autenticação obrigatória" });
        }

        const data = createPaymentSchema.parse(req.body);
        const loggedId = Number(req.logged.id);

        let targetCompanyId = data.companyId;

        if (req.logged.type === "admin") {
            if (!targetCompanyId) {
                return res.status(400).json({ error: "Administradores devem especificar o companyId no cadastro do pagamento." });
            }
            const exists = await prisma.company.findUnique({ where: { id: targetCompanyId } });
            if (!exists) {
                return res.status(404).json({ error: "A empresa informada no companyId não existe." });
            }
        } else {
            // É owner
            if (targetCompanyId) {
                const owned = await prisma.company.findFirst({
                    where: { id: targetCompanyId, userId: loggedId }
                });
                if (!owned) {
                    return res.status(403).json({ error: "Você não tem permissão para cadastrar pagamentos para esta empresa." });
                }
            } else {
                const companies = await prisma.company.findMany({
                    where: { userId: loggedId }
                });
                if (companies.length === 0) {
                    return res.status(400).json({ error: "Você não possui nenhuma empresa cadastrada para associar ao pagamento." });
                }
                targetCompanyId = companies[0].id;
            }
        }

        data.companyId = targetCompanyId;

        const p = await prisma.payment.create({ data });
        return res.status(201).json(p);
    } catch (error) {
        return handleErrors(error, res);
    }
}

export async function readPayment(req, res, _next) {
    try {
        if (!req.logged) {
            return res.status(401).json({ error: "Autenticação obrigatória" });
        }

        const { companyId, startDate, endDate, to_date, due_date, paymentForm, advertising, type } = req.query;

        let consult = {};

        if (req.logged.type !== "admin") {
            const userCompanies = await prisma.company.findMany({
                where: { userId: Number(req.logged.id) },
                select: { id: true }
            });
            const companyIds = userCompanies.map(c => c.id);

            if (companyId) {
                const numId = Number(companyId);
                if (isNaN(numId)) throw new Error("A busca companyId deve ser um NÚMERO Inteiro sem aspas ou letras");
                if (!companyIds.includes(numId)) {
                    return res.status(403).json({ error: "Acesso negado. Empresa não pertence a você." });
                }
                consult.companyId = numId;
            } else {
                consult.companyId = { in: companyIds };
            }
        } else if (companyId) {
            const numId = Number(companyId);
            if (isNaN(numId)) throw new Error("A busca companyId deve ser um NÚMERO Inteiro sem aspas ou letras");
            consult.companyId = numId;
        }

        // Intervalo de datas coerente: de startDate até endDate (ou compatibilidade com to_date / due_date como início/fim)
        const dateFrom = startDate || to_date;
        const dateTo = endDate || due_date;

        if (dateFrom && dateTo) {
            consult.toDate = { gte: new Date(dateFrom), lte: new Date(dateTo) };
        } else if (dateFrom) {
            consult.toDate = { gte: new Date(dateFrom) };
        } else if (dateTo) {
            consult.toDate = { lte: new Date(dateTo) };
        }

        if (paymentForm) consult.paymentForm = { contains: paymentForm };
        if (advertising) consult.advertising = { contains: advertising };
        if (type) consult.type = { contains: type };

        const payments = await prisma.payment.findMany({
            where: consult,
            include: { company: true }
        });
        return res.status(200).json(payments);
    } catch (error) {
        if (error.message.includes("A busca")) {
            return res.status(400).json({ erroPrincipal: "Pesquisa mal formulada na Rota", mensagemDoSistema: error.message, instrucaoParaCorrigir: "Utilize somente números id na busca companyId." });
        }
        return handleErrors(error, res);
    }
}

export async function showPayment(req, res, _next) {
    try {
        let id = Number(req.params.id);
        if (isNaN(id)) throw new Error("Url ID Inválido");

        const check = await canAccessPayment(id, req.logged);
        if (!check.allowed) {
            return res.status(check.errorStatus).json({ error: check.errorMsg });
        }

        const p = await prisma.payment.findFirst({
            where: { id: id },
            include: { company: true }
        });

        if (!p) return res.status(404).json({ erroPrincipal: "Pagamento Inexistente", mensagemDoSistema: "ID não encontrado na leitura isolada.", instrucaoParaCorrigir: "Use o ID correto inteiro na URL que de fato exista no banco." });
        return res.status(200).json(p);
    } catch (error) {
        if (error.message === "Url ID Inválido") {
            return res.status(400).json({ erroPrincipal: "O ID precisava ser um numero inteiro positivo", instrucaoParaCorrigir: "Coloque um ID numérico. Exemplo: /payment/1 e NUNCA /payment/letra" });
        }
        return handleErrors(error, res);
    }
}

export async function editPayment(req, res, _next) {
    try {
        let id = Number(req.params.id);
        if (isNaN(id)) throw new Error("Url ID Inválido");

        const check = await canAccessPayment(id, req.logged);
        if (!check.allowed) {
            return res.status(check.errorStatus).json({ error: check.errorMsg });
        }

        const validatedData = editPaymentSchema.parse(req.body);

        let p = await prisma.payment.findFirst({ where: { id: id } });
        if (!p) {
            return res.status(404).json({ erroPrincipal: "Desculpe, Pagamento inválido", mensagemDoSistema: "O ID indicado para editar está órfão", instrucaoParaCorrigir: "Selecione um pagamento ID que exista lá no Prisma" });
        }

        p = attachSave(p, 'payment');

        if (validatedData.toDate !== undefined) p.toDate = validatedData.toDate;
        if (validatedData.dueDate !== undefined) p.dueDate = validatedData.dueDate;
        if (validatedData.paymentForm !== undefined) p.paymentForm = validatedData.paymentForm;
        if (validatedData.advertising !== undefined) p.advertising = validatedData.advertising;
        if (validatedData.key !== undefined) p.key = validatedData.key;
        if (validatedData.type !== undefined) p.type = validatedData.type;

        await p.save();
        return res.status(202).json(p);
    } catch (error) {
        if (error.message === "Url ID Inválido") {
            return res.status(400).json({ erroPrincipal: "Você errou a URL", instrucaoParaCorrigir: "Url ID somente números ex: /payment/2" });
        }
        return handleErrors(error, res);
    }
}

export async function deletePayment(req, res, _next) {
    try {
        let id = Number(req.params.id);
        if (isNaN(id)) throw new Error("Url ID Inválido");

        const check = await canAccessPayment(id, req.logged);
        if (!check.allowed) {
            return res.status(check.errorStatus).json({ error: check.errorMsg });
        }

        let p = await prisma.payment.findFirst({ where: { id: id } });

        if (p) {
            await prisma.payment.delete({ where: { id: id } });
            return res.status(200).json({ mensagem: "Pagamento deletado com sucesso." });
        }

        return res.status(404).json({ erroPrincipal: "Exclusão Proibida", mensagemDoSistema: "Esse id já foi deletado ou não existe...", instrucaoParaCorrigir: "Basta passar na url um id válido do banco caso precise muito deletar" });
    } catch (error) {
        if (error.message === "Url ID Inválido") {
            return res.status(400).json({ erroPrincipal: "Deleção Falhou", instrucaoParaCorrigir: "IDs pra apagar requerem que a rota seja pura, apenas números. Exemplo /payment/10" });
        }
        return handleErrors(error, res);
    }
}