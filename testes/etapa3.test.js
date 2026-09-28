/**
 * Bateria de Testes de Integração — ETAPA 3
 * Voyage Backend: Contratos de Company, Robustez e Integridade Referencial
 *
 * Executar com: node testes/etapa3.test.js
 */

import { setupTestDatabase } from "./helpers/testDb.js";

// Inicializa banco temporário antes de qualquer import do Prisma
const testDb = await setupTestDatabase();

const { default: prisma } = await import("../src/utils/prisma.js");
const { default: app } = await import("../src/app.js");
const { default: bcrypt } = await import("bcrypt");
const { default: jwt } = await import("jsonwebtoken");

const PORT = 4446;
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
    console.log(`🧪 Servidor de teste da Etapa 3 rodando na porta ${PORT}\n`);

    console.log("🧹 Limpando banco de teste...");
    await cleanDatabase();

    try {
        const passwordHash = await bcrypt.hash("Senha123!", 6);

        const ownerUser1 = await prisma.user.create({
            data: {
                name: "Dono Um",
                email: "dono1_et3@test.com",
                password: passwordHash,
                type: "owner",
                signature: "BASIC"
            }
        });

        const ownerUser2 = await prisma.user.create({
            data: {
                name: "Dono Dois",
                email: "dono2_et3@test.com",
                password: passwordHash,
                type: "owner",
                signature: "BASIC"
            }
        });

        const clientUser = await prisma.user.create({
            data: {
                name: "Cliente Etapa 3",
                email: "cliente_et3@test.com",
                password: passwordHash,
                type: "client",
                signature: "BASIC"
            }
        });

        const adminUser = await prisma.user.create({
            data: {
                name: "Admin Etapa 3",
                email: "admin_et3@test.com",
                password: passwordHash,
                type: "admin",
                signature: "PREMIUM"
            }
        });

        const tokenOwner1 = generateToken({ id: ownerUser1.id, name: ownerUser1.name, type: ownerUser1.type });
        const tokenOwner2 = generateToken({ id: ownerUser2.id, name: ownerUser2.name, type: ownerUser2.type });
        const tokenClient = generateToken({ id: clientUser.id, name: clientUser.name, type: clientUser.type });
        const tokenAdmin = generateToken({ id: adminUser.id, name: adminUser.name, type: adminUser.type });

        // CNPJs válidos matematicamente
        const CNPJ_VALIDO_1 = "11222333000181";
        const CNPJ_VALIDO_2 = "97837181000147";
        const CNPJ_VALIDO_3 = "11444777000161";

        let company1Id;
        let company2Id;

        // =========================================================================
        // SEÇÃO 1: Criação de Empresa (POST /company)
        // =========================================================================
        console.log("\n📋 SEÇÃO 1: Criação de Empresa");

        // 1.1 Sem token
        {
            const res = await fetch(`${BASE_URL}/company`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    name: "Restaurante Sem Token",
                    category: "Restaurante",
                    cnpj: CNPJ_VALIDO_1,
                    places: "Rua das Flores, 123"
                })
            });
            assert(res.status === 401, "1.1 POST /company sem token retorna 401");
        }

        // 1.2 Client tenta criar
        {
            const res = await fetch(`${BASE_URL}/company`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${tokenClient}`
                },
                body: JSON.stringify({
                    name: "Restaurante Client",
                    category: "Restaurante",
                    cnpj: CNPJ_VALIDO_1,
                    places: "Rua das Flores, 123"
                })
            });
            assert(res.status === 403, "1.2 Client criando empresa rejeitado com 403 Forbidden");
        }

        // 1.3 CNPJ matematicamente inválido
        {
            const res = await fetch(`${BASE_URL}/company`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${tokenOwner1}`
                },
                body: JSON.stringify({
                    name: "Restaurante CNPJ Fake",
                    category: "Restaurante",
                    cnpj: "11111111000199",
                    places: "Rua das Flores, 123"
                })
            });
            assert(res.status === 400, "1.3 CNPJ inválido matematicamente rejeitado com 400");
        }

        // 1.4 Categoria inválida
        {
            const res = await fetch(`${BASE_URL}/company`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${tokenOwner1}`
                },
                body: JSON.stringify({
                    name: "Restaurante Fake Cat",
                    category: "CategoriaInexistenteXYZ",
                    cnpj: CNPJ_VALIDO_1,
                    places: "Rua das Flores, 123"
                })
            });
            assert(res.status === 400, "1.4 Categoria inválida rejeitada com 400");
        }

        // 1.5 Owner1 cria empresa com sucesso
        {
            const res = await fetch(`${BASE_URL}/company`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${tokenOwner1}`
                },
                body: JSON.stringify({
                    name: "Pizzaria Bela Vista",
                    category: "Pizzaria",
                    cnpj: CNPJ_VALIDO_1,
                    places: "Rua Treze de Maio, 500"
                })
            });
            const data = await res.json();
            assert(res.status === 201, "1.5 Owner cria empresa com 201 Created");
            assert(data.name === "Pizzaria Bela Vista", "1.5 Nome da empresa persistido");
            assert(data.userId === ownerUser1.id, "1.5 Vinculado ao id do owner autenticado");
            company1Id = data.id;
        }

        // 1.6 CNPJ duplicado
        {
            const res = await fetch(`${BASE_URL}/company`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${tokenOwner2}`
                },
                body: JSON.stringify({
                    name: "Outra Pizzaria",
                    category: "Pizzaria",
                    cnpj: CNPJ_VALIDO_1,
                    places: "Outro endereço"
                })
            });
            assert(res.status === 409, "1.6 Tentativa de cadastrar CNPJ duplicado retorna 409 Conflict");
        }

        // 1.7 Owner2 cria segunda empresa
        {
            const res = await fetch(`${BASE_URL}/company`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${tokenOwner2}`
                },
                body: JSON.stringify({
                    name: "Churrascaria Gaúcha",
                    category: "Churrascaria",
                    cnpj: CNPJ_VALIDO_2,
                    places: "Avenida Ibirapuera, 1500"
                })
            });
            const data = await res.json();
            assert(res.status === 201, "1.7 Owner2 cria empresa com 201");
            company2Id = data.id;
        }

        // 1.8 Admin cria empresa
        {
            const res = await fetch(`${BASE_URL}/company`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${tokenAdmin}`
                },
                body: JSON.stringify({
                    name: "Farmácia Central Admin",
                    category: "Farmácia",
                    cnpj: CNPJ_VALIDO_3,
                    places: "Praça da Sé, 10"
                })
            });
            assert(res.status === 201, "1.8 Admin pode cadastrar empresa (201 Created)");
        }

        // =========================================================================
        // SEÇÃO 2: Consulta Pública de Empresas (GET /company e GET /company/:id)
        // =========================================================================
        console.log("\n📋 SEÇÃO 2: Consulta Pública de Empresas");

        // 2.1 GET /company público
        {
            const res = await fetch(`${BASE_URL}/company`);
            const data = await res.json();
            assert(res.status === 200, "2.1 GET /company é público e retorna 200");
            assert(Array.isArray(data) && data.length >= 3, "2.1 Retorna array com empresas cadastradas");
        }

        // 2.2 Filtro por categoria
        {
            const res = await fetch(`${BASE_URL}/company?category=Pizzaria`);
            const data = await res.json();
            assert(res.status === 200, "2.2 Filtro por category retorna 200");
            assert(data.every(c => c.category === "Pizzaria"), "2.2 Todas as empresas retornadas pertencem à categoria Pizzaria");
        }

        // 2.3 GET /company/:id existente
        {
            const res = await fetch(`${BASE_URL}/company/${company1Id}`);
            const data = await res.json();
            assert(res.status === 200, "2.3 GET /company/:id existente retorna 200");
            assert(data.id === company1Id, "2.3 Retorna empresa correta");
        }

        // 2.4 GET /company/:id inexistente
        {
            const res = await fetch(`${BASE_URL}/company/999999`);
            const data = await res.json();
            assert(res.status === 404, "2.4 GET /company/:id inexistente retorna 404 Not Found");
            assert(data.error && data.error.includes("não encontrada"), "2.4 Mensagem amigável de empresa não encontrada");
        }

        // 2.5 GET /company/:id com id inválido
        {
            const res = await fetch(`${BASE_URL}/company/texto_invalido`);
            assert(res.status === 400, "2.5 GET /company/invalido retorna 400 com try/catch seguro");
        }

        // =========================================================================
        // SEÇÃO 3: Edição de Empresa (PUT /company/:id)
        // =========================================================================
        console.log("\n📋 SEÇÃO 3: Edição de Empresa");

        // 3.1 Sem token
        {
            const res = await fetch(`${BASE_URL}/company/${company1Id}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: "Nome Alterado" })
            });
            assert(res.status === 401, "3.1 PUT /company/:id sem token retorna 401");
        }

        // 3.2 Owner alheio tentando editar
        {
            const res = await fetch(`${BASE_URL}/company/${company1Id}`, {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${tokenOwner2}`
                },
                body: JSON.stringify({ name: "Invasão de Empresa" })
            });
            const data = await res.json();
            assert(res.status === 403, "3.2 Owner alheio tentando editar recebe 403 Forbidden");
            assert(data.error && data.error.includes("Acesso negado"), "3.2 Mensagem de acesso negado");
        }

        // 3.3 Dono edita com sucesso
        {
            const res = await fetch(`${BASE_URL}/company/${company1Id}`, {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${tokenOwner1}`
                },
                body: JSON.stringify({
                    name: "Pizzaria Bela Vista Atualizada",
                    places: "Rua Treze de Maio, 502"
                })
            });
            const data = await res.json();
            assert(res.status === 202, "3.3 Dono edita própria empresa com 202 Accepted");
            assert(data.name === "Pizzaria Bela Vista Atualizada", "3.3 Nome atualizado com sucesso");
            assert(data.places === "Rua Treze de Maio, 502", "3.3 Endereço atualizado com sucesso");
        }

        // 3.4 Tentativa de mudar CNPJ para um já em uso
        {
            const res = await fetch(`${BASE_URL}/company/${company1Id}`, {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${tokenOwner1}`
                },
                body: JSON.stringify({ cnpj: CNPJ_VALIDO_2 })
            });
            assert(res.status === 409, "3.4 Alterar para CNPJ já em uso retorna 409 Conflict");
        }

        // 3.5 Editar ID inexistente
        {
            const res = await fetch(`${BASE_URL}/company/999999`, {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${tokenOwner1}`
                },
                body: JSON.stringify({ name: "Empresa Fantasma" })
            });
            assert(res.status === 404, "3.5 Editar empresa inexistente retorna 404 Not Found");
        }

        // 3.6 Admin edita qualquer empresa
        {
            const res = await fetch(`${BASE_URL}/company/${company1Id}`, {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${tokenAdmin}`
                },
                body: JSON.stringify({ evaluate: 4.8 })
            });
            const data = await res.json();
            assert(res.status === 202, "3.6 Admin pode editar qualquer empresa (202 Accepted)");
            assert(data.evaluate === 4.8, "3.6 Campo evaluate atualizado pelo admin");
        }

        // =========================================================================
        // SEÇÃO 4: Exclusão de Empresa e Integridade Referencial (DELETE /company/:id)
        // =========================================================================
        console.log("\n📋 SEÇÃO 4: Exclusão de Empresa e Integridade Referencial");

        // 4.1 Sem token
        {
            const res = await fetch(`${BASE_URL}/company/${company1Id}`, {
                method: "DELETE"
            });
            assert(res.status === 401, "4.1 DELETE /company/:id sem token retorna 401");
        }

        // 4.2 Owner alheio tentando deletar
        {
            const res = await fetch(`${BASE_URL}/company/${company1Id}`, {
                method: "DELETE",
                headers: { Authorization: `Bearer ${tokenOwner2}` }
            });
            assert(res.status === 403, "4.2 Owner alheio tentando deletar recebe 403 Forbidden");
        }

        // 4.3 Cria dependências para company2 (payment, favorite, address)
        {
            await prisma.payment.create({
                data: {
                    companyId: company2Id,
                    toDate: new Date(),
                    dueDate: new Date(Date.now() + 86400000),
                    paymentForm: "PIX",
                    advertising: "BANNER",
                    key: "CHAVE_TESTE_FK",
                    type: "MENSAL"
                }
            });

            await prisma.favorite.create({
                data: {
                    companyId: company2Id,
                    userId: clientUser.id
                }
            });

            const addr = await prisma.address.create({
                data: {
                    place: "Rua da Empresa 2",
                    number: "200",
                    zipcode: "01001-000",
                    lat: -23.55,
                    long: -46.63,
                    url: "https://mock.url/img.png"
                }
            });

            await prisma.addressCompany.create({
                data: {
                    companyId: company2Id,
                    addressId: addr.id
                }
            });
        }

        // 4.4 Exclusão de empresa que tem pagamentos é REJEITADA com 400
        {
            const res = await fetch(`${BASE_URL}/company/${company2Id}`, {
                method: "DELETE",
                headers: { Authorization: `Bearer ${tokenOwner2}` }
            });
            const data = await res.json();
            assert(res.status === 400, "4.4 Exclusão de empresa com pagamentos vinculados rejeitada com 400");
            assert(data.error && data.error.includes("pagamentos vinculados"), "4.4 Mensagem de proteção de histórico financeiro");

            // Remove o pagamento para testar a exclusão das dependências permitidas
            await prisma.payment.deleteMany({ where: { companyId: company2Id } });

            const resPermitida = await fetch(`${BASE_URL}/company/${company2Id}`, {
                method: "DELETE",
                headers: { Authorization: `Bearer ${tokenOwner2}` }
            });
            const dataPermitida = await resPermitida.json();
            assert(resPermitida.status === 200, "4.4 Dono deleta empresa com dependências permitidas (favorite, address) com 200 OK");
            assert(dataPermitida.message && dataPermitida.message.includes("deletada"), "4.4 Confirmação de exclusão em transação");

            // Verifica que a empresa foi realmente excluída
            const check = await fetch(`${BASE_URL}/company/${company2Id}`);
            assert(check.status === 404, "4.4 Empresa excluída não existe mais no banco (404)");
        }

        // 4.5 Admin deleta qualquer empresa
        {
            const res = await fetch(`${BASE_URL}/company/${company1Id}`, {
                method: "DELETE",
                headers: { Authorization: `Bearer ${tokenAdmin}` }
            });
            assert(res.status === 200, "4.5 Admin deleta qualquer empresa com 200 OK");
        }

        // 4.6 Deletar empresa inexistente retorna 404
        {
            const res = await fetch(`${BASE_URL}/company/999999`, {
                method: "DELETE",
                headers: { Authorization: `Bearer ${tokenAdmin}` }
            });
            assert(res.status === 404, "4.6 Deletar empresa inexistente retorna 404 Not Found");
        }

        // 4.7 Deletar com ID inválido retorna 400
        {
            const res = await fetch(`${BASE_URL}/company/invalido`, {
                method: "DELETE",
                headers: { Authorization: `Bearer ${tokenAdmin}` }
            });
            assert(res.status === 400, "4.7 Deletar empresa com ID inválido retorna 400 com try/catch seguro");
        }

    } catch (err) {
        console.error("❌ Erro fatal na execução dos testes:", err);
    } finally {
        server.close();
        await testDb.cleanup(prisma);
        console.log("\n════════════════════════════════════════════════════════════");
        console.log(`📊 RESULTADO ETAPA 3: ${passed} aprovados, ${failed} reprovados, ${skipped} pulados`);
        console.log("════════════════════════════════════════════════════════════\n");

        if (failed > 0) {
            process.exit(1);
        }
    }
}

run();
