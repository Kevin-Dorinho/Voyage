/**
 * Bateria de Testes de Integração — ETAPA 4
 * Voyage Backend: Regras de Negócio, Validações Cronológicas e Favoritos
 *
 * Executar com: node testes/etapa4.test.js
 */

import { setupTestDatabase } from "./helpers/testDb.js";

// Inicializa banco temporário antes de qualquer import do Prisma
const testDb = await setupTestDatabase();

const { default: prisma } = await import("../src/utils/prisma.js");
const { default: app } = await import("../src/app.js");
const { default: bcrypt } = await import("bcrypt");
const { default: jwt } = await import("jsonwebtoken");

const PORT = 4447;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const JWT_SECRET = process.env.JWT_SECRET;

let server;
let passed = 0;
let failed = 0;
let skipped = 0;

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

async function cleanDatabase() {
    await prisma.addressCompany.deleteMany({});
    await prisma.payment.deleteMany({});
    await prisma.favorite.deleteMany({});
    await prisma.company.deleteMany({});
    await prisma.address.deleteMany({});
    await prisma.user.deleteMany({});
}

async function run() {
    server = app.listen(PORT);
    console.log(`🧪 Servidor de teste da Etapa 4 rodando na porta ${PORT}\n`);

    console.log("🧹 Limpando banco de teste...");
    await cleanDatabase();

    try {
        const passwordHash = await bcrypt.hash("Senha123!", 6);

        const ownerUser = await prisma.user.create({
            data: {
                name: "Owner Etapa 4",
                email: "owner_et4@test.com",
                password: passwordHash,
                type: "owner",
                signature: "BASIC"
            }
        });

        const clientUser = await prisma.user.create({
            data: {
                name: "Client Etapa 4",
                email: "client_et4@test.com",
                password: passwordHash,
                type: "client",
                signature: "BASIC"
            }
        });

        const tokenOwner = generateToken({ id: ownerUser.id, name: ownerUser.name, type: ownerUser.type });
        const tokenClient = generateToken({ id: clientUser.id, name: clientUser.name, type: clientUser.type });

        // Cria empresas para os testes
        const companyPizzaria = await prisma.company.create({
            data: {
                name: "Pizzaria Regra Negocio",
                category: "Pizzaria",
                cnpj: "11222333000181",
                places: "Rua A, 100",
                userId: ownerUser.id
            }
        });

        const companyRestaurante = await prisma.company.create({
            data: {
                name: "Restaurante Regra Negocio",
                category: "Restaurante",
                cnpj: "97837181000147",
                places: "Rua B, 200",
                userId: ownerUser.id
            }
        });

        // =========================================================================
        // SEÇÃO 1: Validações Cronológicas de Datas de Pagamento
        // =========================================================================
        console.log("\n📋 SEÇÃO 1: Validações Cronológicas de Datas de Pagamento");

        // 1.1 dueDate anterior à toDate no cadastro
        {
            const res = await fetch(`${BASE_URL}/payment`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${tokenOwner}`
                },
                body: JSON.stringify({
                    companyId: companyPizzaria.id,
                    toDate: "2026-06-15T00:00:00Z",
                    dueDate: "2026-06-10T00:00:00Z", // Vencimento anterior ao início!
                    paymentForm: "PIX",
                    advertising: "Campanha Junho",
                    key: "CHAVE123",
                    type: "mensal"
                })
            });
            const data = await res.json();
            assert(res.status === 400, "1.1 dueDate anterior à toDate rejeitado com 400");
            assert(data.error && data.error.includes("não pode ser anterior"), "1.1 Mensagem clara de inconsistência cronológica");
        }

        let paymentId;

        // 1.2 Cadastro de pagamento com datas válidas (dueDate >= toDate)
        {
            const res = await fetch(`${BASE_URL}/payment`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${tokenOwner}`
                },
                body: JSON.stringify({
                    companyId: companyPizzaria.id,
                    toDate: "2026-06-01T00:00:00Z",
                    dueDate: "2026-06-30T00:00:00Z",
                    paymentForm: "PIX",
                    advertising: "Campanha Válida",
                    key: "CHAVE_CORRETA",
                    type: "mensal"
                })
            });
            const data = await res.json();
            assert(res.status === 201, "1.2 Pagamento com datas cronologicamente consistentes retorna 201");
            paymentId = data.id;
        }

        // 1.3 Edição: tentar alterar dueDate para antes de toDate existente
        {
            const res = await fetch(`${BASE_URL}/payment/${paymentId}`, {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${tokenOwner}`
                },
                body: JSON.stringify({
                    dueDate: "2026-05-01T00:00:00Z" // Anterior a 2026-06-01
                })
            });
            const data = await res.json();
            assert(res.status === 400, "1.3 Edição com dueDate anterior à toDate existente rejeitada com 400");
        }

        // 1.4 Edição: tentar alterar toDate para depois de dueDate existente
        {
            const res = await fetch(`${BASE_URL}/payment/${paymentId}`, {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${tokenOwner}`
                },
                body: JSON.stringify({
                    toDate: "2026-07-15T00:00:00Z" // Posterior a 2026-06-30
                })
            });
            assert(res.status === 400, "1.4 Edição com toDate posterior à dueDate existente rejeitada com 400");
        }

        // 1.5 Edição com datas válidas
        {
            const res = await fetch(`${BASE_URL}/payment/${paymentId}`, {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${tokenOwner}`
                },
                body: JSON.stringify({
                    toDate: "2026-06-05T00:00:00Z",
                    dueDate: "2026-07-05T00:00:00Z"
                })
            });
            assert(res.status === 202, "1.5 Edição com datas cronologicamente válidas retorna 202 Accepted");
        }

        // =========================================================================
        // SEÇÃO 2: Filtros de Datas em readPayment
        // =========================================================================
        console.log("\n📋 SEÇÃO 2: Filtros de Datas em readPayment");

        // 2.1 Filtro por to_date
        {
            const res = await fetch(`${BASE_URL}/payment?to_date=2026-06-01`, {
                headers: { Authorization: `Bearer ${tokenOwner}` }
            });
            const data = await res.json();
            assert(res.status === 200, "2.1 GET /payment?to_date retorna 200");
            assert(data.some(p => p.id === paymentId), "2.1 Retorna o pagamento filtrado");
        }

        // 2.2 Filtro por due_date
        {
            const res = await fetch(`${BASE_URL}/payment?due_date=2026-07-10`, {
                headers: { Authorization: `Bearer ${tokenOwner}` }
            });
            const data = await res.json();
            assert(res.status === 200, "2.2 GET /payment?due_date retorna 200");
            assert(data.some(p => p.id === paymentId), "2.2 Retorna o pagamento filtrado");
        }

        // 2.3 Filtro com data inválida
        {
            const res = await fetch(`${BASE_URL}/payment?to_date=data_invalida_xyz`, {
                headers: { Authorization: `Bearer ${tokenOwner}` }
            });
            assert(res.status === 400, "2.3 Filtro com to_date inválido retorna 400");
        }

        // 2.4 Filtro com to_date posterior à due_date
        {
            const res = await fetch(`${BASE_URL}/payment?to_date=2026-12-01&due_date=2026-01-01`, {
                headers: { Authorization: `Bearer ${tokenOwner}` }
            });
            assert(res.status === 400, "2.4 Filtro com to_date > due_date retorna 400");
        }

        // =========================================================================
        // SEÇÃO 3: Regras de Negócio e Unicidade de Favoritos
        // =========================================================================
        console.log("\n📋 SEÇÃO 3: Regras de Negócio e Unicidade de Favoritos");

        // 3.1 Favoritar sem token
        {
            const res = await fetch(`${BASE_URL}/company/${companyPizzaria.id}/favorite`, {
                method: "POST"
            });
            assert(res.status === 401, "3.1 POST /company/:id/favorite sem token retorna 401");
        }

        // 3.2 Cliente favorita empresa
        {
            const res = await fetch(`${BASE_URL}/company/${companyPizzaria.id}/favorite`, {
                method: "POST",
                headers: { Authorization: `Bearer ${tokenClient}` }
            });
            const data = await res.json();
            assert(res.status === 201, "3.2 Cliente favorita empresa com 201 Created");
            assert(data.companyId === companyPizzaria.id, "3.2 Empresa favoritada corretamente");
            assert(data.userId === clientUser.id, "3.2 Vinculado ao cliente logado");
        }

        // 3.3 Tentar favoritar a mesma empresa novamente (garantia de unicidade)
        {
            const res = await fetch(`${BASE_URL}/company/${companyPizzaria.id}/favorite`, {
                method: "POST",
                headers: { Authorization: `Bearer ${tokenClient}` }
            });
            const data = await res.json();
            assert(res.status === 409, "3.3 Tentativa de duplicar favorito rejeitada com 409 Conflict");
            assert(data.error && data.error.includes("já está"), "3.3 Mensagem indica que a empresa já é favorita");
        }

        // 3.4 Favoritar empresa inexistente
        {
            const res = await fetch(`${BASE_URL}/company/999999/favorite`, {
                method: "POST",
                headers: { Authorization: `Bearer ${tokenClient}` }
            });
            assert(res.status === 404, "3.4 Favoritar empresa inexistente retorna 404 Not Found");
        }

        // 3.5 Listar favoritos do usuário
        {
            const res = await fetch(`${BASE_URL}/company/favorites`, {
                headers: { Authorization: `Bearer ${tokenClient}` }
            });
            const data = await res.json();
            assert(res.status === 200, "3.5 GET /company/favorites retorna 200 OK");
            assert(Array.isArray(data) && data.length === 1, "3.5 Retorna array com 1 favorito");
            assert(data[0].companyId === companyPizzaria.id, "3.5 Empresa favoritada presente na lista");
        }

        // 3.6 Desfavoritar empresa
        {
            const res = await fetch(`${BASE_URL}/company/${companyPizzaria.id}/favorite`, {
                method: "DELETE",
                headers: { Authorization: `Bearer ${tokenClient}` }
            });
            const data = await res.json();
            assert(res.status === 200, "3.6 DELETE /company/:id/favorite desfavorita com 200 OK");
            assert(data.message && data.message.includes("removida"), "3.6 Mensagem de remoção dos favoritos");
        }

        // 3.7 Desfavoritar novamente empresa que não está nos favoritos
        {
            const res = await fetch(`${BASE_URL}/company/${companyPizzaria.id}/favorite`, {
                method: "DELETE",
                headers: { Authorization: `Bearer ${tokenClient}` }
            });
            assert(res.status === 404, "3.7 Desfavoritar empresa não favoritada retorna 404 Not Found");
        }

        // =========================================================================
        // SEÇÃO 4: Filtros Combinados de category + favorite em readAddress
        // =========================================================================
        console.log("\n📋 SEÇÃO 4: Filtros Combinados de category + favorite em readAddress");

        // Cria endereços vinculados às duas empresas
        const addrPizza = await prisma.address.create({
            data: {
                place: "Rua da Pizza",
                number: "100",
                zipcode: "01001-000",
                lat: -23.55,
                long: -46.63,
                url: "https://mock/pizza.png"
            }
        });
        await prisma.addressCompany.create({
            data: { addressId: addrPizza.id, companyId: companyPizzaria.id }
        });

        const addrRestaurante = await prisma.address.create({
            data: {
                place: "Rua do Restaurante",
                number: "200",
                zipcode: "01002-000",
                lat: -23.56,
                long: -46.64,
                url: "https://mock/rest.png"
            }
        });
        await prisma.addressCompany.create({
            data: { addressId: addrRestaurante.id, companyId: companyRestaurante.id }
        });

        // Cliente favorita APENAS a pizzaria
        await prisma.favorite.create({
            data: { userId: clientUser.id, companyId: companyPizzaria.id }
        });

        // 4.1 Filtro combinando category=Pizzaria e favorite=clientUser.id
        {
            const res = await fetch(`${BASE_URL}/address?category=Pizzaria&favorite=${clientUser.id}`, {
                headers: { Authorization: `Bearer ${tokenClient}` }
            });
            const data = await res.json();
            assert(res.status === 200, "4.1 GET /address com category + favorite retorna 200");
            assert(data.length === 1 && data[0].id === addrPizza.id, "4.1 Retorna apenas o endereço da Pizzaria favoritada");
        }

        // 4.2 Filtro combinando category=Restaurante e favorite=clientUser.id (restaurante NÃO foi favoritado)
        {
            const res = await fetch(`${BASE_URL}/address?category=Restaurante&favorite=${clientUser.id}`, {
                headers: { Authorization: `Bearer ${tokenClient}` }
            });
            const data = await res.json();
            assert(res.status === 200, "4.2 GET /address com categoria não favoritada retorna 200");
            assert(data.length === 0, "4.2 Retorna lista vazia pois o restaurante não está nos favoritos");
        }

    } catch (err) {
        console.error("❌ Erro fatal na execução dos testes:", err);
    } finally {
        server.close();
        await testDb.cleanup(prisma);
        console.log("\n════════════════════════════════════════════════════════════");
        console.log(`📊 RESULTADO ETAPA 4: ${passed} aprovados, ${failed} reprovados, ${skipped} pulados`);
        console.log("════════════════════════════════════════════════════════════\n");

        if (failed > 0) {
            process.exit(1);
        }
    }
}

run();
