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
    toDate: z.coerce.date({ required_error: "Data Inicial toDate ausente", invalid_type_error: "toDate deve ter formato válido como 2026-02-28 00:00:00Z" }),
    dueDate: z.coerce.date({ required_error: "Data Final dueDate ausente", invalid_type_error: "dueDate deve ter formato válido" }),
    paymentForm: z.string({ required_error: "paymentForm está ausente", invalid_type_error: "paymentForm precisa ser escrito entre aspas" }).min(1, "Não aceita forms vazios"),
    advertising: z.string({ required_error: "advertising está ausente", invalid_type_error: "advertising precisa ser escrito entre aspas" }).min(1),
    key: z.string({ required_error: "Falha, a key não foi passada" }).min(1),
    type: z.string({ required_error: "Falha, não indicou type" }).min(1)
});

const editPaymentSchema = createPaymentSchema.partial();

export async function createPayment(req, res, _next) {
    try {
        // Pega o id do usuario logado no token JWT e converte para Número (para evitar erro de tipagem no Zod)
        const data = createPaymentSchema.parse(req.body);
        if (req.logged && req.logged.id) {
            if (req.logged.type === "owner") {
                let c = await prisma.company.findFirst({ where: { userId: Number(req.logged.id) } });
                data.companyId = Number(c.id);
            }
        }

        console.log(data);


        let p = await prisma.payment.create({ data });
        return res.status(201).json(p);
    } catch (error) {

        console.log(error.message);
        return handleErrors(error, res);
    }
}

export async function readPayment(req, res, _next) {
    try {
        const { companyId, to_date, due_date, paymentForm, advertising, type } = req.query;

        let consult = {};
        if (companyId) {
            let numId = Number(companyId);
            if (isNaN(numId)) throw new Error("A busca companyId deve ser um NÚMERO Inteiro sem aspas ou letras");
            consult.companyId = numId;
        }
        if (to_date && due_date) consult.toDate = { lt: new Date(to_date), gt: new Date(due_date) };
        if (paymentForm) consult.paymentForm = { contains: "%" + paymentForm + "%" };
        if (advertising) consult.advertising = { contains: "%" + advertising + "%" };
        if (type) consult.type = { contains: "%" + type + "%" };

        let payments = await prisma.payment.findMany({ where: consult });
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

        let p = await prisma.payment.findFirst({ where: { id: id } });
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
        const { to_date, due_date, paymentForm, advertising, key, type } = req.body

        const validatedData = editPaymentSchema.parse(req.body);
        let p = await prisma.payment.findFirst({ where: { id: id } });

        if (!p) {
            return res.status(404).json({ erroPrincipal: "Desculpe, Pagamento inválido", mensagemDoSistema: "O ID indicado para editar está órfão", instrucaoParaCorrigir: "Selecione um pagamento ID que exista lá no Prisma" });
        }

        p = attachSave(p, 'payment');

        if (to_date) p.to_date = to_date;
        if (due_date) p.due_date = due_date;
        if (paymentForm) p.paymentForm = paymentForm;
        if (advertising) p.advertising = advertising;
        if (key) p.key = key;
        if (type) p.type = type;

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

        let p = await prisma.payment.findFirst({ where: { id: id } });

        if (p) {
            await prisma.payment.delete({ where: { id: id } });
            return res.status(200).json({ mensagem: "Uhuu, ação realizada! Pagamento deletado com sucesso para todo o sempre." });
        }

        return res.status(404).json({ erroPrincipal: "Exclusão Proibida", mensagemDoSistema: "Esse id já foi deletado ou não existe...", instrucaoParaCorrigir: "Basta passar na url um id válido do banco caso precise muito deletar" });
    } catch (error) {
        if (error.message === "Url ID Inválido") {
            return res.status(400).json({ erroPrincipal: "Deleção Falhou", instrucaoParaCorrigir: "IDs pra apagar requerem que a rota seja pura, apenas números. Exemplo /payment/10" });
        }
        return handleErrors(error, res);
    }
}