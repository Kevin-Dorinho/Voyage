/**
 * Bateria de Testes de Regressão — Segurança, Privacidade e Integridade
 *
 * Valida:
 * 1. Banco temporário exclusivo (isolado de dev.db).
 * 2. Paridade total usando a montagem real de app.js.
 * 3. Não exposição de dados de usuários/hashes em GET /address/:id.
 * 4. Rejeição de companyId alheio em POST /address SEM chamada ao provedor de upload.
 * 5. Rejeição de DELETE /company/:id quando há pagamentos vinculados (sem deleção destrutiva).
 * 6. Exclusão de relações permitidas em transação atômica.
 *
 * Executar com: node testes/regressao_seguranca.test.js
 */

import { setupTestDatabase } from "./helpers/testDb.js";

// Configura banco temporário ANTES de importar qualquer módulo da aplicação
const testDb = await setupTestDatabase();

// Imports dinâmicos APÓS a inicialização de process.env.DATABASE_URL
const { default: prisma } = await import("../src/utils/prisma.js");
const { default: app } = await import("../src/app.js");
const { setCustomUploadHandler } = await import("../src/utils/uploader.js");
const { default: bcrypt } = await import("bcrypt");
const { default: jwt } = await import("jsonwebtoken");

const PORT = 4455;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const JWT_SECRET = process.env.JWT_SECRET;

let server;
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

function generateToken(payload) {
    return jwt.sign(payload, JWT_SECRET, { subject: String(payload.id), expiresIn: "1h" });
}

const VALID_PNG_BYTES = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64"
);

function createValidImageBlob(filename = "foto.png") {
    return new File([VALID_PNG_BYTES], filename, { type: "image/png" });
}

async function run() {
    server = app.listen(PORT);
    console.log(`🧪 Servidor de teste de regressão rodando em ${BASE_URL}`);
    console.log(`🗄️  Banco temporário exclusivo ativo em: ${testDb.dbUrl}\n`);

    let uploadCallCount = 0;
    setCustomUploadHandler(async (file) => {
        uploadCallCount++;
        return `https://i.ibb.co/mock/${file.originalname || "image.jpg"}`;
    });

    try {
        const passwordHash = await bcrypt.hash("SenhaSecretaSuperForte123!", 6);

        // Usuário com dados pessoais sensíveis
        const sensitiveUser = await prisma.user.create({
            data: {
                name: "João Silva Privado",
                email: "joao.privado@empresa.com",
                password: passwordHash,
                cpf: "123.456.789-00",
                phone: "(11) 98765-4321",
                type: "owner",
                signature: "BASIC"
            }
        });

        // Segundo owner para testes de posse de empresa
        const secondOwner = await prisma.user.create({
            data: {
                name: "Maria Santos",
                email: "maria.santos@empresa.com",
                password: passwordHash,
                type: "owner",
                signature: "BASIC"
            }
        });

        const tokenOwner1 = generateToken({ id: sensitiveUser.id, name: sensitiveUser.name, type: sensitiveUser.type });
        const tokenOwner2 = generateToken({ id: secondOwner.id, name: secondOwner.name, type: secondOwner.type });

        // Empresa pertencente à Maria (Owner 2)
        const companyOwner2 = await prisma.company.create({
            data: {
                name: "Empresa de Maria",
                category: "Restaurante",
                cnpj: "11222333000181",
                places: "Avenida Central, 500",
                userId: secondOwner.id
            }
        });

        // Empresa pertencente ao João (Owner 1)
        const companyOwner1 = await prisma.company.create({
            data: {
                name: "Empresa do Joao",
                category: "Pizzaria",
                cnpj: "97837181000147",
                places: "Rua do Joao, 100",
                userId: sensitiveUser.id
            }
        });

        // =========================================================================
        // TESTE 1: GET /address/:id NÃO expõe usuários, senhas ou dados privados
        // =========================================================================
        console.log("📋 TESTE 1: Privacidade e Não Exposição de Usuários em GET /address/:id");

        const testAddress = await prisma.address.create({
            data: {
                place: "Rua da Privacidade",
                number: "100",
                zipcode: "01001-000",
                lat: -23.5505,
                long: -46.6333,
                url: "https://mock.url/privacidade.jpg",
                users: {
                    connect: { id: sensitiveUser.id }
                },
                addressCompany: {
                    create: { companyId: companyOwner1.id }
                }
            }
        });

        {
            const res = await fetch(`${BASE_URL}/address/${testAddress.id}`);
            const data = await res.json();
            const rawJson = JSON.stringify(data);

            assert(res.status === 200, "1.1 GET /address/:id retorna 200");
            assert(data.users === undefined, "1.2 Campo 'users' NÃO está presente na resposta");
            assert(data.password === undefined, "1.3 Campo 'password' NÃO está presente na resposta");
            assert(data.cpf === undefined, "1.4 Campo 'cpf' NÃO está presente na resposta");
            assert(data.phone === undefined, "1.5 Campo 'phone' NÃO está presente na resposta");
            assert(!rawJson.includes("123.456.789-00"), "1.6 CPF do usuário não aparece no payload JSON");
            assert(!rawJson.includes("(11) 98765-4321"), "1.7 Telefone do usuário não aparece no payload JSON");
            assert(!rawJson.includes(passwordHash), "1.8 Hash de senha não aparece no payload JSON");
            assert(!rawJson.includes("joao.privado@empresa.com"), "1.9 E-mail pessoal do usuário não é exposto");
            assert(data.place === "Rua da Privacidade", "1.10 Dados legítimos do endereço foram retornados com seleção explícita");
        }

        // =========================================================================
        // TESTE 2: POST /address rejeita companyId de terceiros SEM acionar upload
        // =========================================================================
        console.log("\n📋 TESTE 2: Validação de Posse de Empresa ANTES de Enviar Arquivo ao Provedor");

        {
            uploadCallCount = 0; // zera contador

            // João tenta associar a empresa de Maria
            const form = new FormData();
            form.append("place", "Avenida Tentativa Invasao");
            form.append("number", "10");
            form.append("zipcode", "01002-000");
            form.append("lat", "-23.5510");
            form.append("long", "-46.6340");
            form.append("companyId", String(companyOwner2.id)); // Pertence à Maria!
            form.append("file", createValidImageBlob());

            const res = await fetch(`${BASE_URL}/address`, {
                method: "POST",
                headers: { Authorization: `Bearer ${tokenOwner1}` }, // João logado
                body: form
            });
            const data = await res.json();

            assert(res.status === 403, "2.1 Tentativa de associar endereço à empresa de outro usuário retorna 403 Forbidden");
            assert(data.error && data.error.includes("não pertence a você"), "2.2 Mensagem indica claramente que a empresa não pertence ao usuário");
            assert(uploadCallCount === 0, "2.3 Upload para o provedor NÃO foi chamado (economia de rede/storage e proteção preventiva)");
        }

        // =========================================================================
        // TESTE 3: DELETE /company/:id REJEITA exclusão quando há pagamentos
        // =========================================================================
        console.log("\n📋 TESTE 3: Preservação de Histórico Financeiro na Exclusão de Empresa");

        // Cria pagamento vinculado à empresa do João
        const testPayment = await prisma.payment.create({
            data: {
                companyId: companyOwner1.id,
                toDate: new Date("2026-06-01T00:00:00Z"),
                dueDate: new Date("2026-06-30T00:00:00Z"),
                paymentForm: "PIX",
                advertising: "Anúncio Importante",
                key: "CHAVE_FINANCEIRA_123",
                type: "mensal"
            }
        });

        {
            // João tenta deletar sua empresa que tem pagamento
            const res = await fetch(`${BASE_URL}/company/${companyOwner1.id}`, {
                method: "DELETE",
                headers: { Authorization: `Bearer ${tokenOwner1}` }
            });
            const data = await res.json();

            assert(res.status === 400, "3.1 Exclusão de empresa com pagamentos vinculados rejeitada com 400");
            assert(data.error && data.error.includes("pagamentos vinculados"), "3.2 Mensagem clara explicando impedimento por histórico de pagamentos");

            // Confirma que a empresa continua existindo
            const companyCheck = await prisma.company.findUnique({ where: { id: companyOwner1.id } });
            assert(companyCheck !== null, "3.3 A empresa NÃO foi excluída");

            // Confirma que o pagamento continua intacto
            const paymentCheck = await prisma.payment.findUnique({ where: { id: testPayment.id } });
            assert(paymentCheck !== null, "3.4 O pagamento NÃO foi apagado");
        }

        // =========================================================================
        // TESTE 4: Exclusão sem pagamentos executa em transação atômica
        // =========================================================================
        console.log("\n📋 TESTE 4: Exclusão de Empresa em Transação Atômica");

        // Empresa sem pagamentos mas com favorito e endereço
        const companySemPagamento = await prisma.company.create({
            data: {
                name: "Empresa Sem Pagamento",
                category: "Farmácia",
                cnpj: "11444777000161",
                places: "Rua C, 300",
                userId: sensitiveUser.id
            }
        });

        await prisma.favorite.create({
            data: {
                companyId: companySemPagamento.id,
                userId: secondOwner.id
            }
        });

        await prisma.addressCompany.create({
            data: {
                companyId: companySemPagamento.id,
                addressId: testAddress.id
            }
        });

        {
            const res = await fetch(`${BASE_URL}/company/${companySemPagamento.id}`, {
                method: "DELETE",
                headers: { Authorization: `Bearer ${tokenOwner1}` }
            });
            const data = await res.json();

            assert(res.status === 200, "4.1 Empresa sem pagamentos deletada com 200 OK");
            assert(data.message && data.message.includes("deletada com sucesso"), "4.2 Mensagem de sucesso na exclusão");

            // Confirma que os vínculos foram limpos em transação
            const favCount = await prisma.favorite.count({ where: { companyId: companySemPagamento.id } });
            const addrAssocCount = await prisma.addressCompany.count({ where: { companyId: companySemPagamento.id } });
            const companyExists = await prisma.company.findUnique({ where: { id: companySemPagamento.id } });

            assert(favCount === 0, "4.3 Favoritos vinculados foram limpos na transação");
            assert(addrAssocCount === 0, "4.4 Associações de endereço foram limpas na transação");
            assert(companyExists === null, "4.5 Registro da empresa foi removido do banco");
        }

    } catch (err) {
        console.error("❌ Erro fatal nos testes de regressão:", err);
    } finally {
        server.close();
        await testDb.cleanup(prisma);
        console.log("\n════════════════════════════════════════════════════════════");
        console.log(`📊 RESULTADO REGRESSÃO: ${passed} aprovados, ${failed} reprovados`);
        console.log("════════════════════════════════════════════════════════════\n");

        if (failed > 0) {
            process.exit(1);
        }
    }
}

run();
