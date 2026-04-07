import { PrismaClient } from "@prisma/client";
import { z } from 'zod';
import { attachSave } from "../utils/save.js";
const prisma = new PrismaClient();


//req: requisição do que esta vindo do frontend
//res: response o que vou responder
//next: proximo o que vou fazer a seguir
export async function createPayment(req, res, _next) {
    try {
        const data = req.body
        let p = await prisma.payment.create({ data });
        return res.status(201).json(p);
    } catch (error) {
        return res.status(500).json({ error: "Erro ao criar pagamento", details: error.message });
    }
}

export async function readPayment(req, res, _next) {
    try {
        const { companyId, to_date, due_date, paymentForm, advertising, type } = req.query

        let consult = {}
        if (companyId) consult.companyId = Number(companyId)
        if (to_date && due_date) consult.to_date = { lt: Number(to_date), gt: Number(due_date) }
        if (paymentForm) consult.paymentForm = { contains: "%" + paymentForm + "%" }
        if (advertising) consult.advertising = { contains: "%" + advertising + "%" }
        if (type) consult.type = { contains: "%" + type + "%" }

        let payments = await prisma.payment.findMany({ where: consult });

        return res.status(200).json(payments);
    } catch (error) {
        return res.status(500).json({ error: "Erro ao buscar pagamentos", details: error.message });
    }
}

export async function showPayment(req, res, _next) {
    try {
        let id = Number(req.params.id);
        let p = await prisma.payment.findFirst({ where: { id: id } });
        return res.status(200).json(p);
    } catch (error) {
        return res.status(500).json({ error: "Erro ao buscar pagamento", details: error.message });
    }
}

export async function editPayment(req, res, _next) {
    try {
        let id = Number(req.params.id);
        const { to_date, due_date, value, paymentForm, advertising, key, type } = req.body

        let p = await prisma.payment.findFirst({ where: { id: id } })

        if (!p) {
            return res.status(404).json("Não encontrei " + id);
        }

        p = attachSave(p, 'payment');

        if (to_date) p.to_date = to_date;
        if (due_date) p.due_date = due_date;
        if (value) p.value = value;
        if (paymentForm) p.paymentForm = paymentForm;
        if (advertising) p.advertising = advertising;
        if (key) p.key = key;
        if (type) p.type = type;

        await p.save();
        return res.status(202).json(p);
    } catch (error) {
        return res.status(500).json({ error: "Erro ao editar pagamento", details: error.message });
    }
}

export async function deletePayment(req, res, _next) {
    try {
        let id = Number(req.params.id);
        let p = await prisma.payment.findFirst({ where: { id: id } })

        if (p) {
            await prisma.payment.delete({ where: { id: id } });
            return res.status(404).json("deletado com sucesso");
        }

        return res.status(200).json("Não foi encontrado");
    } catch (error) {
        return res.status(500).json({ error: "Erro ao deletar pagamento", details: error.message });
    }
}