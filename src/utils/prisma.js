// src/utils/prisma.js
// Instância singleton do PrismaClient.
// Todos os módulos devem importar daqui em vez de criar novas instâncias.

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export default prisma;
