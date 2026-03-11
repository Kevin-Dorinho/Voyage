import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

export function attachSave(model, table) {
    model.save = async function () {
        const data = { ...this };
        delete data.save;

        return prisma[table].update({
            where: { id: this.id },
            data
        });
    };

    return model;
}