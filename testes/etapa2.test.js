/**
 * Bateria de Testes de Integração — ETAPA 2
 * Voyage Backend: Endereços, Uploads e attachSave
 *
 * Executar com: node testes/etapa2.test.js
 */

import { setupTestDatabase } from "./helpers/testDb.js";

// Inicializa banco temporário antes de qualquer import do Prisma
const testDb = await setupTestDatabase();

const { default: prisma } = await import("../src/utils/prisma.js");
const { default: app } = await import("../src/app.js");
const { setCustomUploadHandler } = await import("../src/utils/uploader.js");
const { attachSave } = await import("../src/utils/save.js");
const { default: bcrypt } = await import("bcrypt");
const { default: jwt } = await import("jsonwebtoken");

const PORT = 4445;
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

// Buffer de imagem PNG 1x1 autêntica com cabeçalho e magic numbers válidos
const VALID_PNG_BYTES = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64"
);

// Cria um Blob de imagem válido para testes de sucesso
function createValidImageBlob(filename = "test.png", mimeType = "image/png") {
    return new File([VALID_PNG_BYTES], filename, { type: mimeType });
}

// Cria um arquivo disfarçado de imagem (MIME válido, mas conteúdo de texto/script não-imagem)
function createDisguisedFakeImageBlob(filename = "malicioso.png") {
    const textBytes = new TextEncoder().encode("ESTE ARQUIVO É UM TEXTO DISFARÇADO DE IMAGEM");
    return new File([textBytes], filename, { type: "image/png" });
}

// Cria um arquivo não-imagem (MIME inválido)
function createFakeTextBlob(filename = "test.txt") {
    const buffer = new TextEncoder().encode("not an image");
    return new File([buffer], filename, { type: "text/plain" });
}

function createFakeBigImageBlob(filename = "gigante.jpg", size = 6 * 1024 * 1024) {
    const buffer = new Uint8Array(size);
    return new File([buffer], filename, { type: "image/jpeg" });
}

// Cria arquivo JPEG truncado (cabeçalho SOI e APP0 válidos, mas sem dados SOF/SOS/EOI)
function createTruncatedHeaderJpegBlob(filename = "truncado.jpg") {
    const buffer = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01, 0x00, 0x60, 0x00, 0x60, 0x00, 0x00]);
    return new File([buffer], filename, { type: "image/jpeg" });
}

// Cria arquivo PNG truncado (cabeçalho PNG e IHDR válidos, mas sem chunk IEND)
function createTruncatedHeaderPngBlob(filename = "truncado.png") {
    const buffer = new Uint8Array([
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
        0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
        0x00, 0x00, 0x00, 0x0A, 0x00, 0x00, 0x00, 0x0A,
        0x08, 0x02, 0x00, 0x00, 0x00
    ]);
    return new File([buffer], filename, { type: "image/png" });
}

// Cria arquivo PNG com cabeçalho e IHDR válidos mas SEM dados de pixels (sem chunk IDAT)
function createPngWithoutPixelDataBlob(filename = "sem_pixels.png") {
    const buffer = Buffer.from([
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
        0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
        0x00, 0x00, 0x00, 0x0A, 0x00, 0x00, 0x00, 0x0A,
        0x08, 0x02, 0x00, 0x00, 0x00, 0x02, 0x50, 0x58, 0xEA,
        0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44,
        0xAE, 0x42, 0x60, 0x82
    ]);
    return new File([buffer], filename, { type: "image/png" });
}

async function run() {
    server = app.listen(PORT);
    console.log(`🧪 Servidor de teste da Etapa 2 rodando na porta ${PORT}\n`);

    console.log("🧹 Limpando banco de teste...");
    await cleanDatabase();

    // Configura mock do upload handler para testes rápidos
    setCustomUploadHandler(async (file) => {
        return `https://i.ibb.co/mock/${file.originalname || "image.png"}`;
    });

    try {
        // Pré-requisito: criar usuários (owner1, owner2, client1, admin1)
        const passwordHash = await bcrypt.hash("Senha123!", 6);

        const ownerUser1 = await prisma.user.create({
            data: {
                name: "Owner Um",
                email: "owner1_et2@test.com",
                password: passwordHash,
                type: "owner",
                signature: "BASIC"
            }
        });

        const ownerUser2 = await prisma.user.create({
            data: {
                name: "Owner Dois",
                email: "owner2_et2@test.com",
                password: passwordHash,
                type: "owner",
                signature: "BASIC"
            }
        });

        const clientUser = await prisma.user.create({
            data: {
                name: "Cliente Um",
                email: "client_et2@test.com",
                password: passwordHash,
                type: "client",
                signature: "BASIC"
            }
        });

        const adminUser = await prisma.user.create({
            data: {
                name: "Admin Um",
                email: "admin_et2@test.com",
                password: passwordHash,
                type: "admin",
                signature: "PREMIUM"
            }
        });

        // Empresas para testes de vínculo
        const company1 = await prisma.company.create({
            data: {
                name: "Pizzaria Etapa 2",
                category: "Pizzaria",
                cnpj: "11222333000181",
                places: "Rua das Pizzas, 100",
                userId: ownerUser1.id
            }
        });

        const company2 = await prisma.company.create({
            data: {
                name: "Hamburgueria Etapa 2",
                category: "Lanchonete",
                cnpj: "22333444000192",
                places: "Rua Augusta, 500",
                userId: ownerUser2.id
            }
        });

        const tokenOwner1 = generateToken({ id: ownerUser1.id, name: ownerUser1.name, type: ownerUser1.type });
        const tokenOwner2 = generateToken({ id: ownerUser2.id, name: ownerUser2.name, type: ownerUser2.type });
        const tokenClient = generateToken({ id: clientUser.id, name: clientUser.name, type: clientUser.type });
        const tokenAdmin = generateToken({ id: adminUser.id, name: adminUser.name, type: adminUser.type });

        // =========================================================================
        // SEÇÃO 1: Proteção e Autenticação no Cadastro de Endereço (POST /address)
        // =========================================================================
        console.log("\n📋 SEÇÃO 1: Proteção e Autenticação no Cadastro de Endereço");

        // 1.1 Sem token
        {
            const form = new FormData();
            form.append("place", "Avenida Central");
            form.append("number", "100");
            form.append("zipcode", "01001-000");
            form.append("lat", "-23.5505");
            form.append("long", "-46.6333");
            form.append("file", createValidImageBlob());

            const res = await fetch(`${BASE_URL}/address`, {
                method: "POST",
                body: form
            });
            assert(res.status === 401, "1.1 POST /address sem token retorna 401 Unauthorized");
        }

        // 1.2 Token inválido
        {
            const form = new FormData();
            form.append("place", "Avenida Central");
            form.append("number", "100");
            form.append("zipcode", "01001-000");
            form.append("lat", "-23.5505");
            form.append("long", "-46.6333");
            form.append("file", createValidImageBlob());

            const res = await fetch(`${BASE_URL}/address`, {
                method: "POST",
                headers: { Authorization: "Bearer token_invalido_xyz" },
                body: form
            });
            assert(res.status === 401, "1.2 POST /address com token inválido retorna 401");
        }

        // 1.3 Sem arquivo de imagem
        {
            const form = new FormData();
            form.append("place", "Avenida Central");
            form.append("number", "100");
            form.append("zipcode", "01001-000");
            form.append("lat", "-23.5505");
            form.append("long", "-46.6333");

            const res = await fetch(`${BASE_URL}/address`, {
                method: "POST",
                headers: { Authorization: `Bearer ${tokenOwner1}` },
                body: form
            });
            const data = await res.json();
            assert(res.status === 400, "1.3 POST /address sem arquivo retorna 400");
            assert(data.error && data.error.includes("imagem"), "1.3 Mensagem indica obrigatoriedade de imagem");
        }

        // 1.4 Arquivo de tipo não permitido (ex: text/plain)
        {
            const form = new FormData();
            form.append("place", "Avenida Central");
            form.append("number", "100");
            form.append("zipcode", "01001-000");
            form.append("lat", "-23.5505");
            form.append("long", "-46.6333");
            form.append("file", createFakeTextBlob("documento.txt"));

            const res = await fetch(`${BASE_URL}/address`, {
                method: "POST",
                headers: { Authorization: `Bearer ${tokenOwner1}` },
                body: form
            });
            const data = await res.json();
            assert(res.status === 400, "1.4 Arquivo não-imagem rejeitado com 400");
            assert(data.error && /imagen|imagem/i.test(data.error), "1.4 Mensagem de erro informa tipo inválido de arquivo");
        }

        // 1.4.b Arquivo inválido disfarçado de imagem (MIME image/png mas conteúdo não-imagem)
        {
            const form = new FormData();
            form.append("place", "Avenida Central");
            form.append("number", "100");
            form.append("zipcode", "01001-000");
            form.append("lat", "-23.5505");
            form.append("long", "-46.6333");
            form.append("file", createDisguisedFakeImageBlob("malicioso.png"));

            const res = await fetch(`${BASE_URL}/address`, {
                method: "POST",
                headers: { Authorization: `Bearer ${tokenOwner1}` },
                body: form
            });
            const data = await res.json();
            assert(res.status === 400, "1.4.b Arquivo disfarçado de imagem rejeitado pela validação de conteúdo real");
        }

        // 1.4.c Arquivo JPEG truncado (cabeçalho válido SOI/APP0, mas dados incompletos/sem SOS/EOI)
        {
            const form = new FormData();
            form.append("place", "Avenida Central");
            form.append("number", "100");
            form.append("zipcode", "01001-000");
            form.append("lat", "-23.5505");
            form.append("long", "-46.6333");
            form.append("file", createTruncatedHeaderJpegBlob("truncado.jpg"));

            const res = await fetch(`${BASE_URL}/address`, {
                method: "POST",
                headers: { Authorization: `Bearer ${tokenOwner1}` },
                body: form
            });
            const data = await res.json();
            assert(res.status === 400, "1.4.c Arquivo JPEG truncado rejeitado na decodificação com 400");
            assert(data.error && /truncado|decodificação/i.test(data.error), "1.4.c Mensagem de erro informa falha de decodificação ou arquivo truncado");
        }

        // 1.4.d Arquivo PNG truncado (cabeçalho e IHDR válidos, mas sem chunk IEND)
        {
            const form = new FormData();
            form.append("place", "Avenida Central");
            form.append("number", "100");
            form.append("zipcode", "01001-000");
            form.append("lat", "-23.5505");
            form.append("long", "-46.6333");
            form.append("file", createTruncatedHeaderPngBlob("truncado.png"));

            const res = await fetch(`${BASE_URL}/address`, {
                method: "POST",
                headers: { Authorization: `Bearer ${tokenOwner1}` },
                body: form
            });
            const data = await res.json();
            assert(res.status === 400, "1.4.d Arquivo PNG truncado rejeitado na decodificação com 400");
            assert(data.error && /truncado|decodificação/i.test(data.error), "1.4.d Mensagem de erro informa falha de decodificação ou arquivo truncado");
        }

        // 1.4.e Arquivo PNG sem dados de pixels (sem IDAT) rejeitado na decodificação com 400
        {
            const form = new FormData();
            form.append("place", "Avenida Sem Pixels");
            form.append("number", "100");
            form.append("zipcode", "01001-000");
            form.append("lat", "-23.5505");
            form.append("long", "-46.6333");
            form.append("file", createPngWithoutPixelDataBlob("sem_pixels.png"));

            const res = await fetch(`${BASE_URL}/address`, {
                method: "POST",
                headers: { Authorization: `Bearer ${tokenOwner1}` },
                body: form
            });
            const data = await res.json();
            assert(res.status === 400, "1.4.e Arquivo PNG sem dados de pixels rejeitado na decodificação com 400");
            assert(data.error && /truncado|decodificação|pixels/i.test(data.error), "1.4.e Mensagem de erro informa falha de decodificação de pixels");
        }

        // 1.5 CEP e número inválidos
        {
            const form = new FormData();
            form.append("place", "Rua Válida");
            form.append("number", "numero_muito_longo_invalido_12345678");
            form.append("zipcode", "cep_errado");
            form.append("lat", "-23.5505");
            form.append("long", "-46.6333");
            form.append("file", createValidImageBlob());

            const res = await fetch(`${BASE_URL}/address`, {
                method: "POST",
                headers: { Authorization: `Bearer ${tokenOwner1}` },
                body: form
            });
            assert(res.status === 400, "1.5 Formato de CEP e número inválidos rejeitados com 400");
        }

        // 1.6 Coordenadas inválidas
        {
            const form = new FormData();
            form.append("place", "Rua Válida");
            form.append("number", "10");
            form.append("zipcode", "01001-000");
            form.append("lat", "120"); // lat > 90
            form.append("long", "-46.6333");
            form.append("file", createValidImageBlob());

            const res = await fetch(`${BASE_URL}/address`, {
                method: "POST",
                headers: { Authorization: `Bearer ${tokenOwner1}` },
                body: form
            });
            assert(res.status === 400, "1.6 Latitude fora dos limites (-90 a 90) rejeitada com 400");
        }

        // =========================================================================
        // SEÇÃO 2: Criação de Endereço com Sucesso e Vínculo ao Criador
        // =========================================================================
        console.log("\n📋 SEÇÃO 2: Criação de Endereço com Sucesso e Vínculo ao Criador");

        let addressOwner1Id;
        let addressOwner2Id;
        let commercialAddress1Id;
        let commercialAddress2Id;

        // 2.1 Owner1 cria endereço pessoal (sem companyId)
        {
            const form = new FormData();
            form.append("place", "Avenida Paulista");
            form.append("number", "1000");
            form.append("zipcode", "01310-100");
            form.append("lat", "-23.5615");
            form.append("long", "-46.6559");
            form.append("file", createValidImageBlob("paulista.png"));

            const res = await fetch(`${BASE_URL}/address`, {
                method: "POST",
                headers: { Authorization: `Bearer ${tokenOwner1}` },
                body: form
            });
            const data = await res.json();
            assert(res.status === 201, "2.1 Criação de endereço retorna 201 Created");
            assert(typeof data.id === "number", "2.1 Endereço criado possui id numérico");
            assert(data.place === "Avenida Paulista", "2.1 Place salvo corretamente");
            assert(data.number === "1000", "2.1 Number salvo corretamente");
            assert(data.url && data.url.includes("paulista.png"), "2.1 URL da imagem gerada pelo upload");

            addressOwner1Id = data.id;

            // Verifica no banco se o criador foi associado em users
            const inDb = await prisma.address.findUnique({
                where: { id: addressOwner1Id },
                include: { users: true }
            });
            assert(inDb.users.some(u => u.id === ownerUser1.id), "2.1 Criador vinculado automaticamente como proprietário do endereço");
        }

        // 2.2 Owner2 cria endereço pessoal (sem companyId)
        {
            const form = new FormData();
            form.append("place", "Rua Augusta Residencial");
            form.append("number", "500");
            form.append("zipcode", "01305-000");
            form.append("lat", "-23.5535");
            form.append("long", "-46.6529");
            form.append("file", createValidImageBlob("augusta.png"));

            const res = await fetch(`${BASE_URL}/address`, {
                method: "POST",
                headers: { Authorization: `Bearer ${tokenOwner2}` },
                body: form
            });
            const data = await res.json();
            assert(res.status === 201, "2.2 Owner2 cria endereço com 201");
            addressOwner2Id = data.id;
        }

        // 2.3 Criação com companyId vincula à empresa comercial 1
        {
            const form = new FormData();
            form.append("place", "Rua das Pizzas");
            form.append("number", "100");
            form.append("zipcode", "01400-000");
            form.append("lat", "-23.5700");
            form.append("long", "-46.6600");
            form.append("companyId", String(company1.id));
            form.append("file", createValidImageBlob("pizza_address.png"));

            const res = await fetch(`${BASE_URL}/address`, {
                method: "POST",
                headers: { Authorization: `Bearer ${tokenOwner1}` },
                body: form
            });
            const data = await res.json();
            assert(res.status === 201, "2.3 Endereço com companyId retorna 201");
            commercialAddress1Id = data.id;

            const assoc = await prisma.addressCompany.findFirst({
                where: { addressId: commercialAddress1Id, companyId: company1.id }
            });
            assert(assoc !== null, "2.3 Vínculo addressCompany criado com sucesso");
        }

        // 2.3.b Owner2 cria endereço com companyId para hamburgueria (comercial 2)
        {
            const form = new FormData();
            form.append("place", "Rua das Hamburguerias");
            form.append("number", "200");
            form.append("zipcode", "01401-000");
            form.append("lat", "-23.5710");
            form.append("long", "-46.6610");
            form.append("companyId", String(company2.id));
            form.append("file", createValidImageBlob("burger_address.png"));

            const res = await fetch(`${BASE_URL}/address`, {
                method: "POST",
                headers: { Authorization: `Bearer ${tokenOwner2}` },
                body: form
            });
            const data = await res.json();
            assert(res.status === 201, "2.3.b Endereço comercial de company2 criado com 201");
            commercialAddress2Id = data.id;
        }

        // 2.4 Criação com companyId inexistente retorna 404
        {
            const form = new FormData();
            form.append("place", "Rua Fantasma");
            form.append("number", "99");
            form.append("zipcode", "01001-000");
            form.append("lat", "-23.5500");
            form.append("long", "-46.6300");
            form.append("companyId", "99999");
            form.append("file", createValidImageBlob());

            const res = await fetch(`${BASE_URL}/address`, {
                method: "POST",
                headers: { Authorization: `Bearer ${tokenOwner1}` },
                body: form
            });
            assert(res.status === 404, "2.4 companyId inexistente retorna 404 Not Found");
        }

        // =========================================================================
        // SEÇÃO 3: Leitura e Filtros de Endereço (GET /address e GET /address/:id)
        // =========================================================================
        console.log("\n📋 SEÇÃO 3: Leitura e Filtros de Endereço");

        // 3.1 Consulta pública sem auth retorna SOMENTE endereços comerciais
        {
            const res = await fetch(`${BASE_URL}/address`);
            const data = await res.json();
            assert(res.status === 200, "3.1 GET /address é rota pública e retorna 200");
            assert(Array.isArray(data), "3.1 Retorna lista de endereços comerciais");
            assert(data.every(a => a.id === commercialAddress1Id || a.id === commercialAddress2Id), "3.1 Retorna apenas endereços comerciais associados a empresas");
            assert(!data.some(a => a.id === addressOwner1Id || a.id === addressOwner2Id), "3.1 Endereços pessoais NÃO são divulgados na listagem pública");
        }

        // 3.2 Filtro por lat e long com raio
        {
            const res = await fetch(`${BASE_URL}/address?lat=-23.5700&long=-46.6600&radius=0.05`);
            const data = await res.json();
            assert(res.status === 200, "3.2 GET /address com raio retorna 200");
            assert(data.some(a => a.id === commercialAddress1Id), "3.2 Contém o endereço comercial da Pizzaria");
        }

        // 3.3 Filtro por raio inválido
        {
            const res = await fetch(`${BASE_URL}/address?lat=-23.5615&long=-46.6559&radius=-5`);
            assert(res.status === 400, "3.3 Raio negativo rejeitado com 400");
        }

        // 3.4 Filtro por user não pode vazar endereços pessoais
        {
            const res = await fetch(`${BASE_URL}/address?user=${ownerUser2.id}`);
            const data = await res.json();
            assert(res.status === 200, "3.4 Filtro por user retorna 200");
            assert(data.length === 1 && data[0].id === commercialAddress2Id, "3.4 Retorna apenas o endereço comercial do usuário filtrado");
            assert(!data.some(a => a.id === addressOwner2Id), "3.4 Endereço pessoal do usuário NÃO é retornado pelo parâmetro user");
        }

        // 3.5 Consulta por ID com proteção estrita de endereços pessoais
        {
            // Consulta pública de endereço pessoal retorna 404 Not Found
            const resPublic = await fetch(`${BASE_URL}/address/${addressOwner1Id}`);
            assert(resPublic.status === 404, "3.5 Consulta pública de endereço pessoal retorna 404 Not Found");

            // Dono autenticado do endereço pessoal consegue consultá-lo com sucesso
            const resOwner = await fetch(`${BASE_URL}/address/${addressOwner1Id}`, {
                headers: { Authorization: `Bearer ${tokenOwner1}` }
            });
            const dataOwner = await resOwner.json();
            assert(resOwner.status === 200, "3.5 Dono autenticado consulta seu próprio endereço pessoal (200 OK)");
            assert(dataOwner.id === addressOwner1Id, "3.5 Retorna o endereço correto para o dono");

            // Terceiro autenticado tentando acessar endereço pessoal de outro recebe 404
            const resOther = await fetch(`${BASE_URL}/address/${addressOwner1Id}`, {
                headers: { Authorization: `Bearer ${tokenOwner2}` }
            });
            assert(resOther.status === 404, "3.5 Usuário alheio recebe 404 para endereço pessoal");

            // Consulta pública de endereço comercial retorna 200 OK
            const resComm = await fetch(`${BASE_URL}/address/${commercialAddress1Id}`);
            const dataComm = await resComm.json();
            assert(resComm.status === 200, "3.5 Consulta pública de endereço comercial retorna 200 OK");
            assert(dataComm.id === commercialAddress1Id, "3.5 Retorna o endereço comercial correto");
            assert(dataComm.addressCompany[0].company.name === "Pizzaria Etapa 2", "3.5 Inclui dados públicos da empresa");
        }

        // 3.6 ID inexistente
        {
            const res = await fetch(`${BASE_URL}/address/999999`);
            assert(res.status === 404, "3.6 GET /address/:id para ID inexistente retorna 404");
        }

        // 3.7 ID não numérico
        {
            const res = await fetch(`${BASE_URL}/address/abc`);
            assert(res.status === 400, "3.7 GET /address/:id para ID inválido retorna 400");
        }

        // 3.8 Restrição e proteção de privacidade do parâmetro favorite
        {
            // 3.8.a Visitante anônimo tentando consultar favoritos recebe 401 Unauthorized
            const resVisitor = await fetch(`${BASE_URL}/address?favorite=1`);
            assert(resVisitor.status === 401, "3.8.a Visitante anônimo tentando consultar favoritos recebe 401 Unauthorized");

            // 3.8.b Usuário autenticado tentando espionar favoritos de outro usuário recebe 403 Forbidden
            const resOther = await fetch(`${BASE_URL}/address?favorite=${ownerUser2.id}`, {
                headers: { Authorization: `Bearer ${tokenOwner1}` }
            });
            assert(resOther.status === 403, "3.8.b Usuário tentando consultar favoritos de outra conta recebe 403 Forbidden");

            // 3.8.c Usuário autenticado consultando seus próprios favoritos recebe 200 OK
            const resSelf = await fetch(`${BASE_URL}/address?favorite=${ownerUser1.id}`, {
                headers: { Authorization: `Bearer ${tokenOwner1}` }
            });
            assert(resSelf.status === 200, "3.8.c Usuário consultando seus próprios favoritos recebe 200 OK");
        }

        // =========================================================================
        // SEÇÃO 4: Edição de Endereço (PUT /address/:id)
        // =========================================================================
        console.log("\n📋 SEÇÃO 4: Edição de Endereço");

        // 4.1 Sem auth
        {
            const form = new FormData();
            form.append("place", "Novo Nome");
            const res = await fetch(`${BASE_URL}/address/${addressOwner1Id}`, {
                method: "PUT",
                body: form
            });
            assert(res.status === 401, "4.1 PUT /address/:id sem token retorna 401");
        }

        // 4.2 Outro usuário (não-dono e não-admin) tentando editar
        {
            const form = new FormData();
            form.append("place", "Invasor");
            const res = await fetch(`${BASE_URL}/address/${addressOwner1Id}`, {
                method: "PUT",
                headers: { Authorization: `Bearer ${tokenOwner2}` },
                body: form
            });
            const data = await res.json();
            assert(res.status === 403, "4.2 Usuário alheio tentando editar recebe 403 Forbidden");
            assert(data.error && data.error.includes("dono"), "4.2 Mensagem indica restrição de dono");
        }

        // 4.3 Dono edita campos de texto sem reenviar imagem
        {
            const form = new FormData();
            form.append("place", "Avenida Paulista Renomeada");
            form.append("number", "1002 A");

            const res = await fetch(`${BASE_URL}/address/${addressOwner1Id}`, {
                method: "PUT",
                headers: { Authorization: `Bearer ${tokenOwner1}` },
                body: form
            });
            const data = await res.json();
            assert(res.status === 202, "4.3 Dono edita endereço com 202 Accepted");
            assert(data.place === "Avenida Paulista Renomeada", "4.3 Place atualizado com sucesso");
            assert(data.number === "1002 A", "4.3 Number atualizado com sucesso");
            assert(data.url && data.url.includes("paulista.png"), "4.3 URL da imagem anterior preservada");
        }

        // 4.4 Dono edita com nova imagem
        {
            const form = new FormData();
            form.append("file", createValidImageBlob("paulista_nova.png"));

            const res = await fetch(`${BASE_URL}/address/${addressOwner1Id}`, {
                method: "PUT",
                headers: { Authorization: `Bearer ${tokenOwner1}` },
                body: form
            });
            const data = await res.json();
            assert(res.status === 202, "4.4 Dono edita enviando nova imagem com 202");
            assert(data.url && data.url.includes("paulista_nova.png"), "4.4 Nova URL de imagem atribuída");
        }

        // 4.5 Dono edita coordenadas via multipart string
        {
            const form = new FormData();
            form.append("lat", "-23.5620");
            form.append("long", "-46.6550");

            const res = await fetch(`${BASE_URL}/address/${addressOwner1Id}`, {
                method: "PUT",
                headers: { Authorization: `Bearer ${tokenOwner1}` },
                body: form
            });
            const data = await res.json();
            assert(res.status === 202, "4.5 Dono edita coordenadas recebidas como strings multipart com 202");
            assert(Math.abs(data.lat - (-23.5620)) < 0.0001, "4.5 Latitude numérica atualizada");
            assert(Math.abs(data.long - (-46.6550)) < 0.0001, "4.5 Longitude numérica atualizada");
        }

        // 4.6 Coordenadas inválidas na edição
        {
            const form = new FormData();
            form.append("lat", "999"); // inválido

            const res = await fetch(`${BASE_URL}/address/${addressOwner1Id}`, {
                method: "PUT",
                headers: { Authorization: `Bearer ${tokenOwner1}` },
                body: form
            });
            assert(res.status === 400, "4.6 Coordenadas inválidas na edição retornam 400");
        }

        // 4.7 Admin edita qualquer endereço
        {
            const form = new FormData();
            form.append("place", "Avenida Paulista Editada Pelo Admin");

            const res = await fetch(`${BASE_URL}/address/${addressOwner1Id}`, {
                method: "PUT",
                headers: { Authorization: `Bearer ${tokenAdmin}` },
                body: form
            });
            const data = await res.json();
            assert(res.status === 202, "4.7 Admin tem permissão para editar qualquer endereço (202)");
            assert(data.place === "Avenida Paulista Editada Pelo Admin", "4.7 Alteração do admin refletida");
        }

        // =========================================================================
        // SEÇÃO 5: Exclusão de Endereço (DELETE /address/:id)
        // =========================================================================
        console.log("\n📋 SEÇÃO 5: Exclusão de Endereço");

        // 5.1 Sem token
        {
            const res = await fetch(`${BASE_URL}/address/${addressOwner2Id}`, {
                method: "DELETE"
            });
            assert(res.status === 401, "5.1 DELETE /address/:id sem token retorna 401");
        }

        // 5.2 Outro usuário tentando deletar
        {
            const res = await fetch(`${BASE_URL}/address/${addressOwner2Id}`, {
                method: "DELETE",
                headers: { Authorization: `Bearer ${tokenOwner1}` }
            });
            assert(res.status === 403, "5.2 Usuário alheio tentando deletar recebe 403 Forbidden");
        }

        // 5.3 Dono deleta o próprio endereço
        {
            const res = await fetch(`${BASE_URL}/address/${addressOwner2Id}`, {
                method: "DELETE",
                headers: { Authorization: `Bearer ${tokenOwner2}` }
            });
            const data = await res.json();
            assert(res.status === 200, "5.3 Dono deleta o próprio endereço com 200 OK");
            assert(data.message && data.message.includes("deletado"), "5.3 Mensagem de sucesso na exclusão");

            // Confirma exclusão no GET
            const check = await fetch(`${BASE_URL}/address/${addressOwner2Id}`);
            assert(check.status === 404, "5.3 Endereço excluído não é mais encontrado (404)");
        }

        // 5.4 Admin deleta endereço de qualquer usuário
        {
            const res = await fetch(`${BASE_URL}/address/${addressOwner1Id}`, {
                method: "DELETE",
                headers: { Authorization: `Bearer ${tokenAdmin}` }
            });
            assert(res.status === 200, "5.4 Admin tem permissão para deletar qualquer endereço com 200 OK");
        }

        // 5.5 Deletar ID inexistente retorna 404
        {
            const res = await fetch(`${BASE_URL}/address/999999`, {
                method: "DELETE",
                headers: { Authorization: `Bearer ${tokenAdmin}` }
            });
            assert(res.status === 404, "5.5 Deletar ID inexistente retorna 404");
        }

        // =========================================================================
        // SEÇÃO 6: Robustez do Utilitário attachSave
        // =========================================================================
        console.log("\n📋 SEÇÃO 6: Robustez do Utilitário attachSave");

        // 6.1 attachSave salva modificação escalar
        {
            let comp = await prisma.company.findUnique({ where: { id: company1.id } });
            comp = attachSave(comp, "company");
            comp.name = "Pizzaria Nome Atualizado";
            const updated = await comp.save();
            assert(updated.name === "Pizzaria Nome Atualizado", "6.1 attachSave atualiza o modelo com sucesso");
        }

        // 6.2 attachSave com include de relações e timestamps não quebra
        {
            // Busca empresa incluindo a relação users e payments
            let compWithRelations = await prisma.company.findUnique({
                where: { id: company1.id },
                include: { users: true, payments: true }
            });

            // Se attachSave não filtrasse users e payments, o prisma.company.update quebraria!
            compWithRelations = attachSave(compWithRelations, "company");
            compWithRelations.name = "Pizzaria Com Relacoes Limpas";

            let threw = false;
            try {
                await compWithRelations.save();
            } catch (err) {
                console.error("Erro no save:", err);
                threw = true;
            }

            assert(!threw, "6.2 attachSave filtra relações (users, payments) e timestamps sem lançar erro no Prisma");

            const reCheck = await prisma.company.findUnique({ where: { id: company1.id } });
            assert(reCheck.name === "Pizzaria Com Relacoes Limpas", "6.2 Alteração persistida com sucesso após limpeza de relações");
        }

        // =========================================================================
        // SEÇÃO 7: Limites e Proteções de Upload
        // =========================================================================
        console.log("\n📋 SEÇÃO 7: Limites e Proteções de Upload");

        // 7.1 Arquivo maior que 5MB deve ser rejeitado com 400
        {
            const bigFileBlob = createFakeBigImageBlob("gigante.jpg", 6 * 1024 * 1024); // 6 MB
            const form = new FormData();
            form.append("place", "Rua Grande");
            form.append("number", "100");
            form.append("zipcode", "01001-000");
            form.append("lat", "-23.5500");
            form.append("long", "-46.6300");
            form.append("file", bigFileBlob);

            const res = await fetch(`${BASE_URL}/address`, {
                method: "POST",
                headers: { Authorization: `Bearer ${tokenOwner1}` },
                body: form
            });
            const data = await res.json();
            assert(res.status === 400, "7.1 Arquivo maior que 5MB rejeitado com 400");
            assert(data.error && data.error.includes("5MB"), "7.1 Mensagem de erro informa limite de 5MB");
        }

        // =========================================================================
        // SEÇÃO 8: Perfil Expandido de Company e Alinhamento de Categorias
        // =========================================================================
        console.log("\n📋 SEÇÃO 8: Perfil Expandido de Company e Alinhamento de Categorias");

        // 8.1 Cadastro de empresa com novos campos de perfil (description, phone, email, openingHours, logo)
        let companyProfileId;
        {
            const res = await fetch(`${BASE_URL}/company`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${tokenOwner1}`
                },
                body: JSON.stringify({
                    name: "Cafeteria & Padaria Central",
                    category: "Padaria",
                    cnpj: "97837181000147",
                    places: "Rua do Comércio, 789",
                    description: "Café artesanal e pães de fermentação natural",
                    phone: "(16) 98765-4321",
                    email: "contato@cafecentral.com.br",
                    openingHours: "Seg-Dom: 06h às 20h",
                    logo: "https://mock.url/logo_cafe.png"
                })
            });
            const data = await res.json();
            assert(res.status === 201, "8.1 Cadastro de empresa com campos de perfil retorna 201 Created");
            assert(data.description === "Café artesanal e pães de fermentação natural", "8.1 Campo description persistido");
            assert(data.phone === "(16) 98765-4321", "8.1 Campo phone persistido");
            assert(data.email === "contato@cafecentral.com.br", "8.1 Campo email persistido");
            assert(data.openingHours === "Seg-Dom: 06h às 20h", "8.1 Campo openingHours persistido");
            assert(data.logo === "https://mock.url/logo_cafe.png", "8.1 Campo logo persistido");
            companyProfileId = data.id;
        }

        // 8.2 Normalização de categoria com alias sem acento (ex: 'farmacia' -> 'Farmácia')
        {
            const res = await fetch(`${BASE_URL}/company`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${tokenOwner2}`
                },
                body: JSON.stringify({
                    name: "Farmácia Popular",
                    category: "farmacia", // sem acento e minúsculo
                    cnpj: "11444777000161",
                    places: "Avenida Saúde, 100"
                })
            });
            const data = await res.json();
            assert(res.status === 201, "8.2 Categoria normalizada com sucesso para Farmácia");
            assert(data.category === "Farmácia", "8.2 Categoria persistida como canônica 'Farmácia'");
        }

        // 8.3 Edição dos novos campos de perfil da empresa
        {
            const res = await fetch(`${BASE_URL}/company/${companyProfileId}`, {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${tokenOwner1}`
                },
                body: JSON.stringify({
                    description: "Descrição atualizada da cafeteria",
                    openingHours: "Seg-Sex: 07h às 21h"
                })
            });
            const data = await res.json();
            assert(res.status === 202, "8.3 Edição dos campos de perfil retorna 202 Accepted");
            assert(data.description === "Descrição atualizada da cafeteria", "8.3 Descrição atualizada");
            assert(data.openingHours === "Seg-Sex: 07h às 21h", "8.3 Horário atualizado");
        }

        // 8.4 Bloqueio de evaluate na criação comum de Company
        {
            const res = await fetch(`${BASE_URL}/company`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${tokenOwner1}`
                },
                body: JSON.stringify({
                    name: "Tentativa Avaliação Forjada",
                    category: "Restaurante",
                    cnpj: "56619669553985",
                    places: "Rua do Teste, 1",
                    evaluate: 4.9 // Tentativa de definir nota inicial
                })
            });
            assert(res.status === 403, "8.4 Criação de empresa com evaluate por usuário comum rejeitada com 403 Forbidden");
        }

        // 8.5 Bloqueio de evaluate na edição comum de Company (somente admin permitido)
        {
            // Owner comum tentando alterar evaluate recebe 403 Forbidden
            const resOwner = await fetch(`${BASE_URL}/company/${companyProfileId}`, {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${tokenOwner1}`
                },
                body: JSON.stringify({ evaluate: 5.0 })
            });
            assert(resOwner.status === 403, "8.5 Edição de evaluate por owner comum rejeitada com 403 Forbidden");

            // Admin alterando evaluate recebe 202 Accepted
            const resAdmin = await fetch(`${BASE_URL}/company/${companyProfileId}`, {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${tokenAdmin}`
                },
                body: JSON.stringify({ evaluate: 4.7 })
            });
            const dataAdmin = await resAdmin.json();
            assert(resAdmin.status === 202, "8.5 Edição de evaluate por admin aceita com 202 Accepted");
            assert(dataAdmin.evaluate === 4.7, "8.5 Avaliação moderada pelo admin persistida");
        }

        // 8.6 Cadastro completo com campos de painel, adaptadores e endereço estruturado
        let companyFullId;
        {
            const res = await fetch(`${BASE_URL}/company`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${tokenOwner2}`
                },
                body: JSON.stringify({
                    name: "Boutique & Café Gourmet",
                    category: "Café",
                    cnpj: "54029884066234",
                    description: "Cafés especiais premiados e ambiente acolhedor",
                    phone: "(11) 3456-7890",
                    email: "contato@cafegourmet.com",
                    openingHours: "Seg a Sex das 07h às 19h; Sáb das 08h às 14h",
                    logoUrl: "https://mock.url/logo.png",
                    capa: "https://mock.url/banner.jpg",
                    site: "https://cafegourmet.com.br",
                    whatsApp: "(11) 98765-4321",
                    insta: "@cafegourmetsp",
                    comodidades: ["Wi-Fi Grátis", "Ar Condicionado", "Pet Friendly"],
                    subcategorias: ["Cafés Filtrados", "Espressos", "Grãos"],
                    rua: "Alameda dos Anjos",
                    numero: "500",
                    bairro: "Jardins",
                    cidade: "São Paulo",
                    uf: "SP",
                    cep: "01420-000",
                    complemento: "Bloco B"
                })
            });
            const data = await res.json();
            assert(res.status === 201, "8.6 Cadastro com campos de painel e adaptadores retorna 201 Created");
            companyFullId = data.id;

            // 8.7 Verificação dos Adaptadores nos contratos de resposta
            assert(data.logo === "https://mock.url/logo.png", "8.7 Adaptador logoUrl populou logo");
            assert(data.logoUrl === "https://mock.url/logo.png", "8.7 Resposta inclui espelho logoUrl");
            assert(data.cover === "https://mock.url/banner.jpg", "8.7 Adaptador capa populou cover");
            assert(data.coverUrl === "https://mock.url/banner.jpg", "8.7 Resposta inclui espelho coverUrl");
            assert(data.website === "https://cafegourmet.com.br", "8.7 Adaptador site populou website");
            assert(data.site === "https://cafegourmet.com.br", "8.7 Resposta inclui espelho site");
            assert(data.whatsapp === "(11) 98765-4321", "8.7 Adaptador whatsApp populou whatsapp");
            assert(data.whatsApp === "(11) 98765-4321", "8.7 Resposta inclui espelho whatsApp");
            assert(Array.isArray(data.amenities) && data.amenities.includes("Pet Friendly"), "8.7 Comodidades decodificadas como array");
            assert(Array.isArray(data.subcategories) && data.subcategories.includes("Espressos"), "8.7 Subcategorias decodificadas como array");
            assert(typeof data.openingHours === "string" && data.openingHours.includes("Seg a Sex"), "8.7 openingHours mantido como textual descritivo");
            assert(data.street === "Alameda dos Anjos", "8.7 Endereço estruturado: rua populou street");
            assert(data.city === "São Paulo", "8.7 Endereço estruturado: cidade populou city");
        }

        // 8.8 Limpeza / remoção explícita de valores opcionais (null e "") sem apagar campos ausentes
        {
            // Envia phone como null e site como "" (solicitação explícita de remoção)
            // Omite email e whatsapp (campos ausentes devem ser estritamente preservados)
            const res = await fetch(`${BASE_URL}/company/${companyFullId}`, {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${tokenOwner2}`
                },
                body: JSON.stringify({
                    phone: null,
                    site: ""
                })
            });
            const data = await res.json();
            assert(res.status === 202, "8.8 Edição de limpeza retorna 202 Accepted");
            assert(data.phone === null, "8.8 Campo phone explicitamente removido (null no banco)");
            assert(data.website === null, "8.8 Campo website explicitamente removido através de site: ''");
            assert(data.email === "contato@cafegourmet.com", "8.8 Campo email ausente no body PRESERVADO intacto no banco");
            assert(data.whatsapp === "(11) 98765-4321", "8.8 Campo whatsapp ausente no body PRESERVADO intacto no banco");
            assert(data.street === "Alameda dos Anjos", "8.8 Endereço estruturado ausente no body PRESERVADO");
        }

        // =========================================================================
        // SEÇÃO 8.9: Validação Zod Explícita em editCompany (Limites, Tipos e Formatos)
        // =========================================================================
        console.log("\n📋 SEÇÃO 8.9: Validação Zod Explícita em editCompany");

        // 8.9.a Nome vazio rejeitado com 400
        {
            const res = await fetch(`${BASE_URL}/company/${companyFullId}`, {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${tokenOwner2}`
                },
                body: JSON.stringify({ name: "" })
            });
            assert(res.status === 400, "8.9.a Nome vazio em editCompany rejeitado com 400 Bad Request");
        }

        // 8.9.b Categoria inválida rejeitada com 400
        {
            const res = await fetch(`${BASE_URL}/company/${companyFullId}`, {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${tokenOwner2}`
                },
                body: JSON.stringify({ category: "CategoriaTotalmenteInvalida123" })
            });
            assert(res.status === 400, "8.9.b Categoria inválida em editCompany rejeitada com 400 Bad Request");
        }

        // 8.9.c Descrição acima do limite (500 chars) rejeitada com 400
        {
            const res = await fetch(`${BASE_URL}/company/${companyFullId}`, {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${tokenOwner2}`
                },
                body: JSON.stringify({ description: "A".repeat(501) })
            });
            assert(res.status === 400, "8.9.c Descrição com 501 caracteres rejeitada com 400 Bad Request");
        }

        // 8.9.d Telefone com formato inválido rejeitado com 400
        {
            const res = await fetch(`${BASE_URL}/company/${companyFullId}`, {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${tokenOwner2}`
                },
                body: JSON.stringify({ phone: "123" })
            });
            assert(res.status === 400, "8.9.d Telefone inválido em editCompany rejeitado com 400 Bad Request");
        }

        // 8.9.e Objeto arbitrário passado para campo string rejeitado com 400 (sem conversão implícita)
        {
            const res = await fetch(`${BASE_URL}/company/${companyFullId}`, {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${tokenOwner2}`
                },
                body: JSON.stringify({ name: { hacker: true } })
            });
            assert(res.status === 400, "8.9.e Objeto arbitrário em campo string rejeitado com 400 sem conversão mágica");
        }

        // =========================================================================
        // SEÇÃO 8.10: Atualização Parcial de Endereço e Recálculo de Places
        // =========================================================================
        console.log("\n📋 SEÇÃO 8.10: Atualização Parcial de Endereço e Recálculo de Places");

        // 8.10.a Edição apenas de 'cidade' preserva rua, número e bairro atuais no recálculo de places
        {
            const res = await fetch(`${BASE_URL}/company/${companyFullId}`, {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${tokenOwner2}`
                },
                body: JSON.stringify({
                    cidade: "Campinas",
                    uf: "SP"
                })
            });
            const data = await res.json();
            assert(res.status === 202, "8.10.a Edição apenas da cidade retorna 202");
            assert(data.city === "Campinas", "8.10.a Cidade atualizada para Campinas");
            assert(data.street === "Alameda dos Anjos", "8.10.a Rua original (Alameda dos Anjos) preservada intacta");
            assert(data.number === "500", "8.10.a Número original (500) preservado intacto");
            assert(data.neighborhood === "Jardins", "8.10.a Bairro original (Jardins) preservado intacto");
            assert(data.places.includes("Alameda dos Anjos, 500") && data.places.includes("Campinas - SP"),
                "8.10.a 'places' recalculado combinando rua e número existentes com a nova cidade");
        }

        // 8.10.b Remoção explícita de 'number' (null) preserva o restante no recálculo de places
        {
            const res = await fetch(`${BASE_URL}/company/${companyFullId}`, {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${tokenOwner2}`
                },
                body: JSON.stringify({
                    number: null
                })
            });
            const data = await res.json();
            assert(res.status === 202, "8.10.b Remoção explícita de número retorna 202");
            assert(data.number === null, "8.10.b Campo number atualizado para null");
            assert(data.street === "Alameda dos Anjos", "8.10.b Rua preservada");
            assert(data.places.startsWith("Alameda dos Anjos, Jardins"), "8.10.b 'places' atualizado sem o número mas com rua e bairro");
        }

        // =========================================================================
        // SEÇÃO 8.11: Coerência e Sincronização em Transação (Company ⟷ Address)
        // =========================================================================
        console.log("\n📋 SEÇÃO 8.11: Coerência e Sincronização em Transação (Company ⟷ Address)");

        // 8.11.a Sincronização quando a empresa tem 1 endereço comercial vinculado
        let syncAddressId;
        {
            // Cria um endereço comercial vinculado a companyProfileId
            const form = new FormData();
            form.append("place", "Rua do Café Antigo, 10");
            form.append("number", "10");
            form.append("street", "Rua do Café Antigo");
            form.append("city", "São Paulo");
            form.append("state", "SP");
            form.append("zipcode", "01000-000");
            form.append("lat", "-23.5500");
            form.append("long", "-46.6300");
            form.append("companyId", String(companyProfileId));
            form.append("file", createValidImageBlob("cafe_address.png"));

            const resAddr = await fetch(`${BASE_URL}/address`, {
                method: "POST",
                headers: { Authorization: `Bearer ${tokenOwner1}` },
                body: form
            });
            const addrData = await resAddr.json();
            assert(resAddr.status === 201, "8.11.a Endereço comercial criado para companyProfileId");
            syncAddressId = addrData.id;

            // Edita o endereço da empresa via PUT /company/:id
            const resComp = await fetch(`${BASE_URL}/company/${companyProfileId}`, {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${tokenOwner1}`
                },
                body: JSON.stringify({
                    rua: "Avenida Gourmet Nova",
                    numero: "777",
                    bairro: "Vila Nova",
                    cidade: "São Paulo",
                    uf: "SP"
                })
            });
            assert(resComp.status === 202, "8.11.a Edição da empresa aceita com 202");

            // Verifica se o Address correspondente foi atualizado atomicamente no banco
            const addrInDb = await prisma.address.findUnique({ where: { id: syncAddressId } });
            assert(addrInDb.street === "Avenida Gourmet Nova", "8.11.a Address sincronizado: street atualizado via PUT /company");
            assert(addrInDb.number === "777", "8.11.a Address sincronizado: number atualizado via PUT /company");
            assert(addrInDb.neighborhood === "Vila Nova", "8.11.a Address sincronizado: neighborhood atualizado via PUT /company");
        }

        // 8.11.b Sincronização reversa: Edição via PUT /address/:id sincroniza a empresa vinculada
        {
            const res = await fetch(`${BASE_URL}/address/${syncAddressId}`, {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${tokenOwner1}`
                },
                body: JSON.stringify({
                    street: "Avenida Reversa Sincronizada",
                    number: "888"
                })
            });
            assert(res.status === 202, "8.11.b PUT /address retorna 202");

            // Verifica se Company foi sincronizada atomicamente
            const compInDb = await prisma.company.findUnique({ where: { id: companyProfileId } });
            assert(compInDb.street === "Avenida Reversa Sincronizada", "8.11.b Company sincronizada: street atualizado via PUT /address");
            assert(compInDb.number === "888", "8.11.b Company sincronizada: number atualizado via PUT /address");
        }

        // 8.11.c Múltiplos endereços vinculados: tentativa de alterar endereço sem addressId é rejeitada com 400
        {
            // Cria um segundo endereço para companyProfileId
            const form = new FormData();
            form.append("place", "Rua do Café Filial 2, 20");
            form.append("number", "20");
            form.append("street", "Rua do Café Filial 2");
            form.append("city", "São Paulo");
            form.append("state", "SP");
            form.append("zipcode", "01000-002");
            form.append("lat", "-23.5510");
            form.append("long", "-46.6310");
            form.append("companyId", String(companyProfileId));
            form.append("file", createValidImageBlob("cafe_filial2.png"));

            const resAddr2 = await fetch(`${BASE_URL}/address`, {
                method: "POST",
                headers: { Authorization: `Bearer ${tokenOwner1}` },
                body: form
            });
            assert(resAddr2.status === 201, "8.11.c Segundo endereço criado para a empresa (agora possui 2)");

            // Tenta editar endereço da empresa sem addressId
            const resComp = await fetch(`${BASE_URL}/company/${companyProfileId}`, {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${tokenOwner1}`
                },
                body: JSON.stringify({
                    cidade: "Santos"
                })
            });
            assert(resComp.status === 400, "8.11.c Edição de endereço em empresa com múltiplos endereços sem addressId rejeitada com 400");
            const data = await resComp.json();
            assert(data.error && data.error.includes("múltiplos endereços"), "8.11.c Mensagem exige identificação do endereço via addressId");
        }

        // 8.11.d Com addressId informado, sincroniza o endereço específico
        {
            const resComp = await fetch(`${BASE_URL}/company/${companyProfileId}`, {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${tokenOwner1}`
                },
                body: JSON.stringify({
                    addressId: syncAddressId,
                    cidade: "Santos",
                    uf: "SP"
                })
            });
            assert(resComp.status === 202, "8.11.d Edição com addressId correto aceita com 202");
            const targetInDb = await prisma.address.findUnique({ where: { id: syncAddressId } });
            assert(targetInDb.city === "Santos", "8.11.d Endereço alvo especificado sincronizado para Santos");
        }

        // =========================================================================
        // SEÇÃO 8.12: Contrato Tipado de Comodidades e Subcategorias
        // =========================================================================
        console.log("\n📋 SEÇÃO 8.12: Contrato Tipado de Comodidades e Subcategorias");

        // 8.12.a Envio no formato de objeto de booleanos (formato do frontend)
        {
            const res = await fetch(`${BASE_URL}/company/${companyFullId}`, {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${tokenOwner2}`
                },
                body: JSON.stringify({
                    amenities: {
                        "Wi-Fi Grátis": true,
                        "Ar Condicionado": true,
                        "Estacionamento": true,
                        "Pet Friendly": false
                    }
                })
            });
            const data = await res.json();
            assert(res.status === 202, "8.12.a Comodidades como objeto de booleanos aceitas com 202");
            assert(Array.isArray(data.amenities), "8.12.a Comodidades retornadas como array estável");
            assert(data.amenities.includes("Wi-Fi Grátis") && data.amenities.includes("Estacionamento"),
                "8.12.a Apenas as comodidades com valor true foram incluídas");
            assert(!data.amenities.includes("Pet Friendly"), "8.12.a Comodidade com false não foi incluída");

            // Verifica no banco bruto que NÃO foi gravado "[object Object]"
            const inDb = await prisma.company.findUnique({ where: { id: companyFullId } });
            assert(!inDb.amenities.includes("[object Object]"), "8.12.a Banco NÃO gravou '[object Object]'");
            assert(inDb.amenities.startsWith("[") && inDb.amenities.endsWith("]"), "8.12.a Banco gravou JSON array válido");
        }

        // 8.12.b Rejeição de formatos inválidos de comodidades
        {
            // Objeto com valor não-booleano
            const res1 = await fetch(`${BASE_URL}/company/${companyFullId}`, {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${tokenOwner2}`
                },
                body: JSON.stringify({ amenities: { "Wi-Fi": "sim" } })
            });
            assert(res1.status === 400, "8.12.b Objeto com valor não-booleano rejeitado com 400");

            // Número primitivo
            const res2 = await fetch(`${BASE_URL}/company/${companyFullId}`, {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${tokenOwner2}`
                },
                body: JSON.stringify({ amenities: 12345 })
            });
            assert(res2.status === 400, "8.12.b Número primitivo em amenities rejeitado com 400");

            // Array com valores numéricos
            const res3 = await fetch(`${BASE_URL}/company/${companyFullId}`, {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${tokenOwner2}`
                },
                body: JSON.stringify({ amenities: [1, 2, 3] })
            });
            assert(res3.status === 400, "8.12.b Array com números em amenities rejeitado com 400");
        }

    } catch (err) {
        console.error("❌ Erro fatal na execução dos testes:", err);
    } finally {
        server.close();
        await testDb.cleanup(prisma);
        console.log("\n════════════════════════════════════════════════════════════");
        console.log(`📊 RESULTADO ETAPA 2: ${passed} aprovados, ${failed} reprovados, ${skipped} pulados`);
        console.log("════════════════════════════════════════════════════════════\n");

        if (failed > 0) {
            process.exit(1);
        }
    }
}

run();
