import prisma from "./prisma.js";

/**
 * Anexa o método .save() ao modelo para persistir alterações escalares.
 * Filtra automaticamente:
 * - o próprio método `save`
 * - a chave primária `id`
 * - campos de timestamp gerenciados (`createdAt`, `updatedAt`)
 * - propriedades que representem relações (objetos complexos que não sejam Date, ou arrays)
 * - funções auxiliares
 */
export function attachSave(model, table) {
    if (!model || typeof model !== "object") {
        return model;
    }

    model.save = async function () {
        const data = { ...this };
        delete data.save;
        delete data.id;
        delete data.createdAt;
        delete data.updatedAt;

        for (const [key, value] of Object.entries(data)) {
            if (typeof value === "function") {
                delete data[key];
            } else if (value !== null && typeof value === "object" && !(value instanceof Date)) {
                delete data[key];
            }
        }

        return prisma[table].update({
            where: { id: this.id },
            data
        });
    };

    return model;
}