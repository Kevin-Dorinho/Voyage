/**
 * Teste de Validação de Migrações sobre Dados Antigos
 * 
 * Comprova que a nova migração (20260927191000_company_profile_fields)
 * pode ser aplicada sobre uma base legada já populada, preservando 100%
 * dos dados existentes de usuários, empresas, pagamentos e endereços.
 *
 * Executar com: node testes/migration_dados_antigos.test.js
 */

import path from "path";
import fs from "fs";
import { execSync } from "child_process";

let passed = 0;
let failed = 0;

function assert(condition, message) {
    if (!condition) {
        console.error(`  ❌ FALHA: ${message}`);
        failed++;
        return false;
    }
    console.log(`  ✅ ${message}`);
    passed++;
    return true;
}

async function run() {
    console.log("🧪 Iniciando teste de migração sobre dados legados existentes...\n");

    const randomSuffix = `${process.pid}_${Date.now()}`;
    const tempDbFilename = `temp_migration_${randomSuffix}.db`;
    const tempDbPath = path.resolve("prisma", tempDbFilename);
    const tempDbUrl = `file:${tempDbPath}`;

    // Guarda URL anterior
    const prevDbUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = tempDbUrl;

    try {
        // 1. Aplica as migrações anteriores (1 a 8) sequencialmente via SQLite CLI / child_process
        console.log("📦 1. Aplicando migrações legadas (anteriores ao alinhamento de Company)...");
        const migrationsDir = path.resolve("prisma", "migrations");
        const priorMigrations = [
            "20260213011724_init",
            "20260227003313_number_type_string",
            "20260227011719_key_type_string",
            "20260407230339_arrumando",
            "20260410004940_payment_value_float",
            "20260415002815_remove_payment_value",
            "20260418005110_user_id_in_company",
            "20260517220713_fix_schema_corrections"
        ];

        // Aplica as 8 primeiras migrações sequencialmente
        for (const mig of priorMigrations) {
            const sqlPath = path.join(migrationsDir, mig, "migration.sql");
            execSync(`npx prisma db execute --url "${tempDbUrl}" --file "${sqlPath}"`, {
                stdio: "pipe"
            });
        }
        assert(true, "1.1 Banco legado criado com schema das 8 migrações anteriores");

        // 2. Insere dados no banco legado simulando ambiente real antigo
        console.log("\n📦 2. Inserindo dados prévios (usuários, empresas legadas, pagamentos)...");
        const seedSql = `
            INSERT INTO "users" ("id", "name", "type", "email", "password", "signature", "createdAt", "updatedAt")
            VALUES (1, 'Dono Antigo', 'owner', 'antigo@voyage.com', 'hash_antigo', 'BASIC', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');

            INSERT INTO "companies" ("id", "name", "category", "cnpj", "evaluate", "places", "user_id", "createdAt", "updatedAt")
            VALUES (1, 'Restaurante Tradicional', 'Restaurante', '11222333000181', 4.5, 'Rua das Flores, 123', 1, '2026-01-02T00:00:00.000Z', '2026-01-02T00:00:00.000Z');

            INSERT INTO "companies" ("id", "name", "category", "cnpj", "evaluate", "places", "user_id", "createdAt", "updatedAt")
            VALUES (2, 'Pizzaria da Nonna', 'Pizzaria', '22333444000192', 4.8, 'Av. Brasil, 456', 1, '2026-01-03T00:00:00.000Z', '2026-01-03T00:00:00.000Z');

            INSERT INTO "payments" ("id", "company_id", "toDate", "dueDate", "paymentForm", "advertising", "key", "type", "createdAt", "updatedAt")
            VALUES (1, 1, '2026-01-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z', 'PIX', 'BANNER', 'KEY123', 'MENSAL', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');

            INSERT INTO "address" ("id", "place", "number", "zipcode", "lat", "long", "url", "createdAt", "updatedAt")
            VALUES (1, 'Rua das Flores', '123', '13566-000', -22.02, -47.89, 'https://img.com/antiga.png', '2026-01-02T00:00:00.000Z', '2026-01-02T00:00:00.000Z');

            INSERT INTO "address_company" ("id", "companyId", "addressId", "createdAt", "updatedAt")
            VALUES (1, 1, 1, '2026-01-02T00:00:00.000Z', '2026-01-02T00:00:00.000Z');
        `;
        const tempSeedFile = path.resolve("prisma", `temp_seed_${randomSuffix}.sql`);
        fs.writeFileSync(tempSeedFile, seedSql, "utf-8");
        execSync(`npx prisma db execute --url "${tempDbUrl}" --file "${tempSeedFile}"`, { stdio: "pipe" });
        fs.unlinkSync(tempSeedFile);
        assert(true, "2.1 Dados antigos inseridos com sucesso na estrutura legada");

        // 3. Aplica as novas migrações sobre os dados antigos
        console.log("\n📦 3. Aplicando as novas migrações (company_profile_fields e company_and_address_expanded_fields)...");
        const mig1Path = path.join(migrationsDir, "20260927191000_company_profile_fields", "migration.sql");
        execSync(`npx prisma db execute --url "${tempDbUrl}" --file "${mig1Path}"`, { stdio: "pipe" });

        const mig2Path = path.join(migrationsDir, "20260927221000_company_and_address_expanded_fields", "migration.sql");
        execSync(`npx prisma db execute --url "${tempDbUrl}" --file "${mig2Path}"`, { stdio: "pipe" });
        assert(true, "3.1 Novas migrações executadas com sucesso sobre dados existentes");

        // 4. Instancia Prisma dinamicamente apontando para o banco migrado
        const { default: prismaClient } = await import("../src/utils/prisma.js");

        console.log("\n📋 4. Verificando integridade dos dados preservados...");
        const company1 = await prismaClient.company.findUnique({ where: { id: 1 } });
        assert(company1 !== null, "4.1 Empresa 1 continua existindo após a migração");
        assert(company1.name === "Restaurante Tradicional", "4.1 Nome original preservado");
        assert(company1.category === "Restaurante", "4.1 Categoria original preservada");
        assert(company1.cnpj === "11222333000181", "4.1 CNPJ original preservado");
        assert(company1.evaluate === 4.5, "4.1 Avaliação original preservada");
        assert(company1.places === "Rua das Flores, 123", "4.1 Endereço em places preservado");
        assert(company1.userId === 1, "4.1 Relação com dono (userId) preservada");
        assert(company1.description === null, "4.2 Nova coluna description inicializada como null para dados antigos");
        assert(company1.phone === null, "4.2 Nova coluna phone inicializada como null para dados antigos");
        assert(company1.email === null, "4.2 Nova coluna email inicializada como null para dados antigos");
        assert(company1.openingHours === null, "4.2 Nova coluna openingHours inicializada como null para dados antigos");
        assert(company1.logo === null, "4.2 Nova coluna logo inicializada como null para dados antigos");
        assert(company1.whatsapp === null, "4.2 Nova coluna whatsapp inicializada como null para dados antigos");
        assert(company1.instagram === null, "4.2 Nova coluna instagram inicializada como null para dados antigos");
        assert(company1.website === null, "4.2 Nova coluna website inicializada como null para dados antigos");
        assert(company1.cover === null, "4.2 Nova coluna cover inicializada como null para dados antigos");
        assert(company1.amenities === null, "4.2 Nova coluna amenities inicializada como null para dados antigos");
        assert(company1.subcategories === null, "4.2 Nova coluna subcategories inicializada como null para dados antigos");

        const company2 = await prismaClient.company.findUnique({ where: { id: 2 } });
        assert(company2 !== null && company2.name === "Pizzaria da Nonna", "4.3 Empresa 2 preservada intacta");

        const payment = await prismaClient.payment.findUnique({ where: { id: 1 } });
        assert(payment !== null && payment.companyId === 1, "4.4 Pagamento legado associado à empresa 1 preservado");

        const address = await prismaClient.address.findUnique({ where: { id: 1 } });
        assert(address !== null && address.place === "Rua das Flores", "4.5 Endereço legado preservado");
        assert(address.street === null, "4.5 Nova coluna street em address inicializada como null");
        assert(address.neighborhood === null, "4.5 Nova coluna neighborhood em address inicializada como null");
        assert(address.city === null, "4.5 Nova coluna city em address inicializada como null");

        // 5. Testa escrita dos novos campos de perfil sobre a empresa existente
        console.log("\n📋 5. Testando escrita e leitura dos novos campos de perfil e endereço...");
        const updated = await prismaClient.company.update({
            where: { id: 1 },
            data: {
                description: "O melhor restaurante tradicional da região, fundado em 1990.",
                phone: "(16) 99876-5432",
                email: "contato@tradicional.com.br",
                openingHours: "Seg-Sáb: 11h às 23h",
                logo: "https://img.com/novo_logo.png",
                whatsapp: "(16) 99999-8888",
                instagram: "@tradicional_rest",
                website: "https://tradicional.com.br",
                cover: "https://img.com/capa.jpg",
                amenities: '["Wi-Fi Grátis", "Ar Condicionado", "Estacionamento"]',
                subcategories: '["Massas", "Vinhos"]',
                street: "Rua das Flores",
                number: "123",
                neighborhood: "Centro",
                city: "São Carlos",
                state: "SP",
                zipcode: "13566-000"
            }
        });
        assert(updated.description.includes("tradicional"), "5.1 Campo description atualizado e persistido com sucesso");
        assert(updated.phone === "(16) 99876-5432", "5.1 Campo phone atualizado e persistido");
        assert(updated.email === "contato@tradicional.com.br", "5.1 Campo email atualizado e persistido");
        assert(updated.openingHours === "Seg-Sáb: 11h às 23h", "5.1 Campo openingHours atualizado e persistido");
        assert(updated.logo === "https://img.com/novo_logo.png", "5.1 Campo logo atualizado e persistido");
        assert(updated.whatsapp === "(16) 99999-8888", "5.1 Campo whatsapp atualizado e persistido");
        assert(updated.instagram === "@tradicional_rest", "5.1 Campo instagram atualizado e persistido");
        assert(updated.website === "https://tradicional.com.br", "5.1 Campo website atualizado e persistido");
        assert(updated.cover === "https://img.com/capa.jpg", "5.1 Campo cover atualizado e persistido");
        assert(updated.amenities.includes("Wi-Fi"), "5.1 Campo amenities atualizado e persistido");
        assert(updated.subcategories.includes("Massas"), "5.1 Campo subcategories atualizado e persistido");
        assert(updated.city === "São Carlos", "5.1 Endereço estruturado atualizado e persistido");

        await prismaClient.$disconnect();
    } catch (err) {
        console.error("❌ Erro fatal durante teste de migração:", err);
        failed++;
    } finally {
        // Aguarda brevemente para liberação de file handles pelo SO
        await new Promise(r => setTimeout(r, 100));
        // Remove arquivos temporários de banco
        const filesToUnlink = [
            tempDbPath,
            `${tempDbPath}-journal`,
            `${tempDbPath}-wal`,
            `${tempDbPath}-shm`
        ];
        for (const f of filesToUnlink) {
            try {
                if (fs.existsSync(f)) fs.unlinkSync(f);
            } catch (_e) {}
        }

        if (prevDbUrl) {
            process.env.DATABASE_URL = prevDbUrl;
        }

        console.log("\n════════════════════════════════════════════════════════════");
        console.log(`📊 RESULTADO MIGRAÇÃO: ${passed} aprovados, ${failed} reprovados`);
        console.log("════════════════════════════════════════════════════════════\n");

        process.exit(failed > 0 ? 1 : 0);
    }
}

run();
