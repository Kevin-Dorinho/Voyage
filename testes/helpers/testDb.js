import { execSync } from "child_process";
import path from "path";
import fs from "fs";

/**
 * Cria e inicializa um banco de dados SQLite temporário e exclusivo para a execução do teste.
 * Garante que process.env.DATABASE_URL seja apontada para o banco temporário ANTES
 * que o PrismaClient seja instanciado, protegendo o banco habitual contra qualquer deleteMany.
 */
export async function setupTestDatabase() {
    const originalDatabaseUrl = process.env.DATABASE_URL;
    const randomSuffix = `${process.pid}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const tempDbFilename = `temp_test_${randomSuffix}.db`;
    const tempDbPath = path.resolve("prisma", tempDbFilename);
    const tempDbUrl = `file:${tempDbPath}`;

    // Configura a variável no processo antes de qualquer conexão do Prisma
    process.env.DATABASE_URL = tempDbUrl;

    try {
        execSync("npx prisma migrate deploy", {
            env: {
                ...process.env,
                DATABASE_URL: tempDbUrl
            },
            stdio: "pipe"
        });
    } catch (err) {
        console.error("Falha ao inicializar banco de dados temporário de teste:", err.message);
        throw err;
    }

    return {
        dbPath: tempDbPath,
        dbUrl: tempDbUrl,
        async cleanup(prismaInstance) {
            if (prismaInstance && typeof prismaInstance.$disconnect === "function") {
                await prismaInstance.$disconnect();
            }

            // Aguarda pequeno intervalo no Windows para liberação do descritor de arquivo
            await new Promise((resolve) => setTimeout(resolve, 50));

            // Remove o arquivo de banco temporário e arquivos journal/wal se existirem
            const filesToRemove = [
                tempDbPath,
                `${tempDbPath}-journal`,
                `${tempDbPath}-wal`,
                `${tempDbPath}-shm`
            ];

            for (const file of filesToRemove) {
                for (let attempt = 0; attempt < 5; attempt++) {
                    try {
                        if (fs.existsSync(file)) {
                            fs.unlinkSync(file);
                        }
                        break;
                    } catch (e) {
                        await new Promise((resolve) => setTimeout(resolve, 50));
                    }
                }
            }

            // Restaura a URL original
            if (originalDatabaseUrl) {
                process.env.DATABASE_URL = originalDatabaseUrl;
            }
        }
    };
}
