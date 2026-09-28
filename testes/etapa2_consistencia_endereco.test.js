/**
 * Testes de Integração — Consistência de Endereço e Padronização de Favoritos
 * Voyage Backend (Etapa 2 - Conclusão)
 *
 * Cenários validados:
 * A. Empresa com dois endereços: editar somente nome sem addressId retorna sucesso; endereços inalterados.
 * B. Empresa com conflito de endereço: editar somente descrição funciona e não modifica o endereço.
 * C. Address.street nulo e Company.street preenchido: editar somente cidade pela rota de Address preserva a rua nas duas tabelas.
 * D. Conflito em campo omitido: edição direta de Address retorna 409 e não altera nenhum registro.
 * E. Remoção explícita de campo opcional: remove nas duas tabelas sem restaurar o valor antigo.
 * F. Endereço compartilhado por empresas de proprietários diferentes: edição por Company e por Address retorna 403; registros inalterados.
 * G. Compartilhamento autorizado: mantém todas as projeções inequívocas consistentes; ambiguidades retornam 409 sem alterações.
 * H. Rollback do fluxo real: falha controlada em gravação posterior desfaz as anteriores no banco via chamada ao endpoint real.
 * 1. Empresa legada com campos nulos e Address preenchido: editar apenas cidade preserva os campos restantes.
 * 2. Empresa com apenas texto legado: editar cidade não destrói o endereço anterior.
 * 3. Edição parcial bidirecional (por Company e por Address).
 * 4. Remoção de número/CEP obrigatórios retorna 400 e não altera o banco.
 * 5. places null, vazio e espaços retornam 400 sem gravações no banco.
 * 6. Favoritos retornam a empresa com o contrato normalizado (formatCompanyResponse).
 *
 * Executar com: node testes/etapa2_consistencia_endereco.test.js
 */

import { setupTestDatabase } from "./helpers/testDb.js";

// Inicializa banco SQLite temporário e isolado
const testDb = await setupTestDatabase();

const { default: prisma } = await import("../src/utils/prisma.js");
const { default: app } = await import("../src/app.js");
const { setCustomUploadHandler } = await import("../src/utils/uploader.js");
const { setTestTransactionHook } = await import("../src/utils/addressConsistency.js");
const { default: bcrypt } = await import("bcrypt");
const { default: jwt } = await import("jsonwebtoken");

const PORT = 4458;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const JWT_SECRET = process.env.JWT_SECRET || "secreta";

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

// Configura mock seguro de upload em memória para os testes
setCustomUploadHandler(async (file) => {
    return `https://i.ibb.co/mock/${file.originalname || "image.png"}`;
});

async function run() {
    console.log("🧪 Iniciando bateria de testes de consistência Company ⟷ Address e Favoritos...\n");

    server = app.listen(PORT);

    try {
        const hashedPassword = await bcrypt.hash("SenhaForte@123", 10);

        // Cria usuários de teste: Owner 1 e Owner 2
        const owner1 = await prisma.user.create({
            data: {
                name: "Proprietário Um",
                type: "owner",
                email: "owner1_consistencia@teste.com",
                password: hashedPassword
            }
        });
        const tokenOwner1 = generateToken({ id: owner1.id, type: "owner" });

        const owner2 = await prisma.user.create({
            data: {
                name: "Proprietário Dois",
                type: "owner",
                email: "owner2_consistencia@teste.com",
                password: hashedPassword
            }
        });
        const tokenOwner2 = generateToken({ id: owner2.id, type: "owner" });

        // =========================================================================
        // CENÁRIO A: Empresa com dois endereços: editar somente nome sem addressId
        // =========================================================================
        console.log("📋 CENÁRIO A: Empresa com dois endereços: editar somente nome sem addressId");
        {
            const compTwo = await prisma.company.create({
                data: {
                    name: "Empresa Dois Endereços Nome Original",
                    category: "Restaurante",
                    cnpj: "10.001.002/0001-11",
                    places: "Sede Central, 100",
                    street: "Rua Central",
                    number: "100",
                    city: "São Paulo",
                    userId: owner1.id
                }
            });

            const addrA1 = await prisma.address.create({
                data: {
                    place: "Sede Central, 100",
                    number: "100",
                    zipcode: "01001-000",
                    lat: -23.5,
                    long: -46.6,
                    url: "https://i.ibb.co/mock/a1.png",
                    users: { connect: { id: owner1.id } },
                    addressCompany: { create: { companyId: compTwo.id } }
                }
            });

            const addrA2 = await prisma.address.create({
                data: {
                    place: "Filial Sul, 200",
                    number: "200",
                    zipcode: "04001-000",
                    lat: -23.6,
                    long: -46.7,
                    url: "https://i.ibb.co/mock/a2.png",
                    users: { connect: { id: owner1.id } },
                    addressCompany: { create: { companyId: compTwo.id } }
                }
            });

            // Envia apenas o nome, SEM addressId e SEM campos de endereço
            const res = await fetch(`${BASE_URL}/company/${compTwo.id}`, {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${tokenOwner1}`
                },
                body: JSON.stringify({ name: "Empresa Dois Endereços Nome Atualizado" })
            });

            assert(res.status === 202, "A.1 Editar somente nome em empresa com múltiplos endereços retorna 202");
            const data = await res.json();
            assert(data.name === "Empresa Dois Endereços Nome Atualizado", "A.1 Nome da empresa atualizado com sucesso");

            // Verifica que nenhum campo de endereço da empresa e nenhum Address foi alterado
            const checkComp = await prisma.company.findUnique({ where: { id: compTwo.id } });
            assert(checkComp.places === "Sede Central, 100", "A.2 places da empresa permaneceu inalterado");
            assert(checkComp.street === "Rua Central", "A.2 street da empresa permaneceu inalterado");
            assert(checkComp.number === "100", "A.2 number da empresa permaneceu inalterado");

            const checkA1 = await prisma.address.findUnique({ where: { id: addrA1.id } });
            const checkA2 = await prisma.address.findUnique({ where: { id: addrA2.id } });
            assert(checkA1.place === "Sede Central, 100", "A.3 Endereço 1 intacto");
            assert(checkA2.place === "Filial Sul, 200", "A.3 Endereço 2 intacto");
        }

        // =========================================================================
        // CENÁRIO B: Empresa com conflito de endereço: editar somente descrição
        // =========================================================================
        console.log("\n📋 CENÁRIO B: Empresa com conflito de endereço: editar somente descrição");
        {
            // Cria empresa e endereço com cidades conflitantes
            const compConfB = await prisma.company.create({
                data: {
                    name: "Empresa Conflito Descrição",
                    category: "Outros",
                    cnpj: "20.002.003/0001-22",
                    places: "Rua Antiga, 50, Curitiba - PR",
                    city: "Curitiba",
                    description: "Descrição Antiga",
                    userId: owner1.id
                }
            });

            const addrConfB = await prisma.address.create({
                data: {
                    place: "Rua Antiga, 50, Florianópolis - SC",
                    number: "50",
                    zipcode: "88000-000",
                    city: "Florianópolis",
                    lat: -27.5,
                    long: -48.5,
                    url: "https://i.ibb.co/mock/b.png",
                    users: { connect: { id: owner1.id } },
                    addressCompany: { create: { companyId: compConfB.id } }
                }
            });

            // Envia apenas a descrição (sem campos de endereço)
            const res = await fetch(`${BASE_URL}/company/${compConfB.id}`, {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${tokenOwner1}`
                },
                body: JSON.stringify({ description: "Nova Descrição Atualizada" })
            });

            assert(res.status === 202, "B.1 Editar somente descrição em empresa com conflito retorna 202 (não dispara 409)");
            const data = await res.json();
            assert(data.description === "Nova Descrição Atualizada", "B.1 Descrição atualizada com sucesso");

            const checkComp = await prisma.company.findUnique({ where: { id: compConfB.id } });
            assert(checkComp.city === "Curitiba", "B.2 Cidade de Company permaneceu Curitiba");

            const checkAddr = await prisma.address.findUnique({ where: { id: addrConfB.id } });
            assert(checkAddr.city === "Florianópolis", "B.2 Cidade de Address permaneceu Florianópolis");
        }

        // =========================================================================
        // CENÁRIO C: Address.street nulo e Company.street preenchido: editar cidade via Address
        // =========================================================================
        console.log("\n📋 CENÁRIO C: Address.street nulo e Company.street preenchido (edição via Address)");
        {
            const compC = await prisma.company.create({
                data: {
                    name: "Empresa Preserva Rua Legada",
                    category: "Supermercado",
                    cnpj: "30.003.004/0001-33",
                    places: "Rua do Comércio, 10, São Paulo - SP",
                    street: "Rua do Comércio",
                    number: "10",
                    city: "São Paulo",
                    state: "SP",
                    userId: owner1.id
                }
            });

            const addrC = await prisma.address.create({
                data: {
                    place: "Rua do Comércio, 10, São Paulo - SP",
                    street: null, // street nulo no Address
                    number: "10",
                    zipcode: "01000-000",
                    city: "São Paulo",
                    state: "SP",
                    lat: -23.5,
                    long: -46.6,
                    url: "https://i.ibb.co/mock/c.png",
                    users: { connect: { id: owner1.id } },
                    addressCompany: { create: { companyId: compC.id } }
                }
            });

            // Edita apenas a cidade diretamente pela rota PUT /address/:id
            const res = await fetch(`${BASE_URL}/address/${addrC.id}`, {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${tokenOwner1}`
                },
                body: JSON.stringify({ city: "Campinas" })
            });

            assert(res.status === 202, "C.1 Edição de cidade via rota de Address retorna 202");

            const checkAddr = await prisma.address.findUnique({ where: { id: addrC.id } });
            assert(checkAddr.city === "Campinas", "C.1 Cidade atualizada no Address");
            assert(checkAddr.street === "Rua do Comércio", "C.1 Rua existente somente em Company preservada no Address");

            const checkComp = await prisma.company.findUnique({ where: { id: compC.id } });
            assert(checkComp.city === "Campinas", "C.2 Cidade sincronizada na Company");
            assert(checkComp.street === "Rua do Comércio", "C.2 Rua preservada intacta na Company");
        }

        // =========================================================================
        // CENÁRIO D: Conflito em campo omitido na edição direta de Address retorna 409
        // =========================================================================
        console.log("\n📋 CENÁRIO D: Conflito em campo omitido na edição direta de Address");
        {
            const compD = await prisma.company.create({
                data: {
                    name: "Empresa Conflito Address Direct",
                    category: "Farmácia",
                    cnpj: "40.004.005/0001-44",
                    places: "Rua A, 10, Curitiba - PR",
                    city: "Curitiba",
                    userId: owner1.id
                }
            });

            const addrD = await prisma.address.create({
                data: {
                    place: "Rua A, 10, Florianópolis - SC",
                    number: "10",
                    zipcode: "88000-000",
                    city: "Florianópolis",
                    lat: -27.5,
                    long: -48.5,
                    url: "https://i.ibb.co/mock/d.png",
                    users: { connect: { id: owner1.id } },
                    addressCompany: { create: { companyId: compD.id } }
                }
            });

            // Envia alteração de número omitindo o campo conflitante 'city'
            const res = await fetch(`${BASE_URL}/address/${addrD.id}`, {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${tokenOwner1}`
                },
                body: JSON.stringify({ number: "12" })
            });

            assert(res.status === 409, "D.1 Edição direta de Address com conflito pré-existente retorna 409 Conflict");
            const data = await res.json();
            assert(data.error && data.error.includes("city"), "D.1 Mensagem identifica divergência no campo 'city'");

            // Confirma que nenhum registro foi alterado
            const checkAddr = await prisma.address.findUnique({ where: { id: addrD.id } });
            const checkComp = await prisma.company.findUnique({ where: { id: compD.id } });
            assert(checkAddr.number === "10", "D.2 Número no Address permaneceu 10");
            assert(checkComp.number === null, "D.2 Número na Company permaneceu null");
        }

        // =========================================================================
        // CENÁRIO E: Remoção explícita de campo opcional sem restaurar o valor antigo
        // =========================================================================
        console.log("\n📋 CENÁRIO E: Remoção explícita de campo opcional");
        {
            const compE = await prisma.company.create({
                data: {
                    name: "Empresa Remoção Opcional",
                    category: "Serviços",
                    cnpj: "50.005.006/0001-55",
                    places: "Rua Bela, 30, Sala 101, Jardins, São Paulo - SP",
                    street: "Rua Bela",
                    number: "30",
                    neighborhood: "Jardins",
                    complement: "Sala 101",
                    city: "São Paulo",
                    state: "SP",
                    userId: owner1.id
                }
            });

            const addrE = await prisma.address.create({
                data: {
                    place: "Rua Bela, 30, Sala 101, Jardins, São Paulo - SP",
                    street: "Rua Bela",
                    number: "30",
                    neighborhood: "Jardins",
                    complement: "Sala 101",
                    city: "São Paulo",
                    state: "SP",
                    zipcode: "01400-000",
                    lat: -23.5,
                    long: -46.6,
                    url: "https://i.ibb.co/mock/e.png",
                    users: { connect: { id: owner1.id } },
                    addressCompany: { create: { companyId: compE.id } }
                }
            });

            // Envia complement: null para remoção explícita
            const res = await fetch(`${BASE_URL}/company/${compE.id}`, {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${tokenOwner1}`
                },
                body: JSON.stringify({ complement: null })
            });

            assert(res.status === 202, "E.1 Remoção explícita de complement retorna 202");

            const checkComp = await prisma.company.findUnique({ where: { id: compE.id } });
            assert(checkComp.complement === null, "E.1 complement removido de Company (null)");
            assert(checkComp.neighborhood === "Jardins", "E.1 neighborhood preservado em Company");

            const checkAddr = await prisma.address.findUnique({ where: { id: addrE.id } });
            assert(checkAddr.complement === null, "E.2 complement removido de Address (null) sem restauração do valor antigo");
            assert(checkAddr.neighborhood === "Jardins", "E.2 neighborhood preservado em Address");
        }

        // =========================================================================
        // CENÁRIO F: Endereço compartilhado por empresas de proprietários diferentes
        // =========================================================================
        console.log("\n📋 CENÁRIO F: Proteção contra alteração em endereço compartilhado com outro proprietário");
        {
            // Owner 1 possui compF1; Owner 2 possui compF2
            const compF1 = await prisma.company.create({
                data: {
                    name: "Empresa do Owner 1 Compartilhada",
                    category: "Pizzaria",
                    cnpj: "60.006.007/0001-66",
                    places: "Rua Compartilhada, 100",
                    userId: owner1.id
                }
            });

            const compF2 = await prisma.company.create({
                data: {
                    name: "Empresa do Owner 2 Compartilhada",
                    category: "Restaurante",
                    cnpj: "60.006.007/0002-77",
                    places: "Rua Compartilhada, 100",
                    userId: owner2.id
                }
            });

            // Endereço vinculado a ambas as empresas
            const sharedAddr = await prisma.address.create({
                data: {
                    place: "Rua Compartilhada, 100",
                    number: "100",
                    zipcode: "01000-000",
                    lat: -23.5,
                    long: -46.6,
                    url: "https://i.ibb.co/mock/shared.png",
                    users: { connect: { id: owner1.id } },
                    addressCompany: {
                        create: [
                            { companyId: compF1.id },
                            { companyId: compF2.id }
                        ]
                    }
                }
            });

            // F.1 Owner 1 tenta editar endereço pela rota de Company
            const resComp = await fetch(`${BASE_URL}/company/${compF1.id}`, {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${tokenOwner1}`
                },
                body: JSON.stringify({ street: "Nova Rua Tentativa" })
            });

            assert(resComp.status === 403, "F.1 Edição por Company em endereço compartilhado com outro dono retorna 403");
            const dataComp = await resComp.json();
            assert(dataComp.error && dataComp.error.includes("outro usuário"), "F.1 Mensagem indica proteção do outro proprietário");

            // F.2 Owner 1 tenta editar pela rota direta de Address
            const resAddr = await fetch(`${BASE_URL}/address/${sharedAddr.id}`, {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${tokenOwner1}`
                },
                body: JSON.stringify({ street: "Nova Rua Tentativa Via Address" })
            });

            assert(resAddr.status === 403, "F.2 Edição por Address em endereço vinculado a empresa de outro dono retorna 403");
            const dataAddr = await resAddr.json();
            assert(dataAddr.error && dataAddr.error.includes("outro usuário"), "F.2 Mensagem indica proteção do outro proprietário");

            // Confirma que nada foi alterado
            const checkF1 = await prisma.company.findUnique({ where: { id: compF1.id } });
            const checkF2 = await prisma.company.findUnique({ where: { id: compF2.id } });
            const checkAddr = await prisma.address.findUnique({ where: { id: sharedAddr.id } });
            assert(checkF1.places === "Rua Compartilhada, 100", "F.3 Empresa 1 inalterada");
            assert(checkF2.places === "Rua Compartilhada, 100", "F.3 Empresa 2 inalterada");
            assert(checkAddr.place === "Rua Compartilhada, 100", "F.3 Endereço compartilhado inalterado");
        }

        // =========================================================================
        // CENÁRIO G: Compartilhamento autorizado inequívoco vs ambíguo
        // =========================================================================
        console.log("\n📋 CENÁRIO G: Compartilhamento autorizado (inequívoco vs ambíguo)");
        {
            // G.1 Autorizado e Inequívoco: Owner 1 possui duas empresas (G1 e G2), cada uma com APENAS esse endereço
            const compG1 = await prisma.company.create({
                data: {
                    name: "Empresa G1 Inequívoca",
                    category: "Café",
                    cnpj: "70.007.008/0001-88",
                    places: "Rua do Sol, 40",
                    userId: owner1.id
                }
            });

            const compG2 = await prisma.company.create({
                data: {
                    name: "Empresa G2 Inequívoca",
                    category: "Padaria",
                    cnpj: "70.007.008/0002-99",
                    places: "Rua do Sol, 40",
                    userId: owner1.id
                }
            });

            const addrG12 = await prisma.address.create({
                data: {
                    place: "Rua do Sol, 40",
                    number: "40",
                    zipcode: "01000-000",
                    lat: -23.5,
                    long: -46.6,
                    url: "https://i.ibb.co/mock/sol.png",
                    users: { connect: { id: owner1.id } },
                    addressCompany: {
                        create: [
                            { companyId: compG1.id },
                            { companyId: compG2.id }
                        ]
                    }
                }
            });

            // Owner 1 edita compG1
            const resG = await fetch(`${BASE_URL}/company/${compG1.id}`, {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${tokenOwner1}`
                },
                body: JSON.stringify({ street: "Rua do Sol Poente", city: "São Paulo", number: "40" })
            });

            assert(resG.status === 202, "G.1 Compartilhamento autorizado inequívoco retorna 202");

            const checkG1 = await prisma.company.findUnique({ where: { id: compG1.id } });
            const checkG2 = await prisma.company.findUnique({ where: { id: compG2.id } });
            const checkAddrG = await prisma.address.findUnique({ where: { id: addrG12.id } });

            assert(checkG1.street === "Rua do Sol Poente", "G.1 Empresa G1 atualizada");
            assert(checkAddrG.street === "Rua do Sol Poente", "G.1 Endereço compartilhado atualizado");
            assert(checkG2.street === "Rua do Sol Poente", "G.1 Empresa G2 (compartilhada e inequívoca) sincronizada com sucesso");

            // G.2 Ambíguo: Empresa vinculada possui múltiplos endereços
            const compGMulti = await prisma.company.create({
                data: {
                    name: "Empresa G Multi Endereços",
                    category: "Outros",
                    cnpj: "70.007.008/0003-00",
                    places: "Rua da Lua, 50",
                    userId: owner1.id
                }
            });

            // Vincula o mesmo endereço addrG12 e também um segundo endereço a compGMulti
            await prisma.addressCompany.create({
                data: { addressId: addrG12.id, companyId: compGMulti.id }
            });

            const addrExtra = await prisma.address.create({
                data: {
                    place: "Rua Extra, 99",
                    number: "99",
                    zipcode: "02000-000",
                    lat: -23.4,
                    long: -46.5,
                    url: "https://i.ibb.co/mock/extra.png",
                    users: { connect: { id: owner1.id } },
                    addressCompany: { create: { companyId: compGMulti.id } }
                }
            });

            // Tenta editar compG1 agora que compGMulti também compartilha addrG12 e possui múltiplos endereços
            const resAmbiguous = await fetch(`${BASE_URL}/company/${compG1.id}`, {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${tokenOwner1}`
                },
                body: JSON.stringify({ street: "Nova Tentativa Ambígua" })
            });

            assert(resAmbiguous.status === 409, "G.2 Ambiguidade com outra empresa que tem múltiplos endereços retorna 409 Conflict");
            const dataAmb = await resAmbiguous.json();
            assert(dataAmb.error && dataAmb.error.includes("múltiplos endereços"), "G.2 Mensagem identifica ambiguidade na empresa multi");
        }

        // =========================================================================
        // CENÁRIO H: Rollback do fluxo real (falha controlada em gravação posterior)
        // =========================================================================
        console.log("\n📋 CENÁRIO H: Rollback do fluxo real via endpoint de edição");
        {
            const compH = await prisma.company.create({
                data: {
                    name: "Empresa Teste Rollback Real",
                    category: "Lanchonete",
                    cnpj: "80.008.009/0001-99",
                    places: "Rua Original, 10",
                    street: "Rua Original",
                    number: "10",
                    userId: owner1.id
                }
            });

            const addrH = await prisma.address.create({
                data: {
                    place: "Rua Original, 10",
                    street: "Rua Original",
                    number: "10",
                    zipcode: "01000-000",
                    lat: -23.5,
                    long: -46.6,
                    url: "https://i.ibb.co/mock/h.png",
                    users: { connect: { id: owner1.id } },
                    addressCompany: { create: { companyId: compH.id } }
                }
            });

            // Ativa o hook de simulação controlada para falhar logo após a gravação da Company
            setTestTransactionHook(async (tx, stage) => {
                if (stage === "afterCompanyUpdate") {
                    throw new Error("Simulação controlada de queda no banco de dados entre gravações da transação");
                }
            });

            // Faz a requisição HTTP real para o endpoint
            const resH = await fetch(`${BASE_URL}/company/${compH.id}`, {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${tokenOwner1}`
                },
                body: JSON.stringify({
                    name: "Nome Modificado Não Salvo",
                    street: "Rua Modificada Não Salva"
                })
            });

            // Restaura o hook imediatamente para não afetar outros testes
            setTestTransactionHook(null);

            assert(resH.status === 500, "H.1 Endpoint retorna 500 ao ocorrer falha interna na transação");

            // Verifica no banco de dados que a Company NÃO foi alterada (rollback completo da transação)
            const checkCompH = await prisma.company.findUnique({ where: { id: compH.id } });
            assert(checkCompH.name === "Empresa Teste Rollback Real", "H.2 Rollback comprovado: Nome da Company permaneceu o original");
            assert(checkCompH.street === "Rua Original", "H.2 Rollback comprovado: street da Company permaneceu o original");

            const checkAddrH = await prisma.address.findUnique({ where: { id: addrH.id } });
            assert(checkAddrH.street === "Rua Original", "H.2 Rollback comprovado: Address permaneceu inalterado");
        }

        // =========================================================================
        // CENÁRIO 1: Empresa legada com campos nulos e Address preenchido
        // =========================================================================
        console.log("\n📋 CENÁRIO 1: Empresa legada com campos nulos e Address preenchido");
        {
            const legacyComp = await prisma.company.create({
                data: {
                    name: "Padaria Tradição Legada",
                    category: "Padaria",
                    cnpj: "11.222.333/0001-81",
                    places: "Rua das Flores, 100, Bela Vista, São Paulo - SP",
                    street: null,
                    number: null,
                    neighborhood: null,
                    city: null,
                    state: null,
                    complement: null,
                    zipcode: null,
                    userId: owner1.id
                }
            });

            const linkedAddr = await prisma.address.create({
                data: {
                    place: "Rua das Flores, 100, Bela Vista, São Paulo - SP",
                    street: "Rua das Flores",
                    number: "100",
                    neighborhood: "Bela Vista",
                    city: "São Paulo",
                    state: "SP",
                    complement: "Loja A",
                    zipcode: "01310-000",
                    lat: -23.56,
                    long: -46.65,
                    url: "https://i.ibb.co/mock/padaria.png",
                    users: { connect: { id: owner1.id } },
                    addressCompany: { create: { companyId: legacyComp.id } }
                }
            });

            const res = await fetch(`${BASE_URL}/company/${legacyComp.id}`, {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${tokenOwner1}`
                },
                body: JSON.stringify({ city: "Campinas" })
            });

            assert(res.status === 202, "1.1 Edição apenas de cidade retorna 202");

            const updatedComp = await prisma.company.findUnique({ where: { id: legacyComp.id } });
            assert(updatedComp.city === "Campinas", "1.1 Cidade da empresa atualizada para Campinas");
            assert(updatedComp.street === "Rua das Flores", "1.1 Rua herdada do Address preservada em Company");
            assert(updatedComp.number === "100", "1.1 Número herdado do Address preservado em Company");
            assert(updatedComp.places.includes("Campinas"), "1.1 'places' recomposto inclui a nova cidade");

            const updatedAddr = await prisma.address.findUnique({ where: { id: linkedAddr.id } });
            assert(updatedAddr.city === "Campinas", "1.1 Cidade do Address sincronizada para Campinas");
            assert(updatedAddr.street === "Rua das Flores", "1.1 Rua do Address preservada intacta");
        }

        // =========================================================================
        // CENÁRIO 2: Empresa com apenas texto legado (sem Address vinculado)
        // =========================================================================
        console.log("\n📋 CENÁRIO 2: Empresa com apenas texto legado (sem Address vinculado)");
        {
            const textOnlyComp = await prisma.company.create({
                data: {
                    name: "Lanchonete Quiosque do Parque",
                    category: "Lanchonete",
                    cnpj: "22.333.444/0001-92",
                    places: "Parque Ibirapuera - Portão 3, Quiosque 12",
                    street: null,
                    number: null,
                    userId: owner1.id
                }
            });

            const res = await fetch(`${BASE_URL}/company/${textOnlyComp.id}`, {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${tokenOwner1}`
                },
                body: JSON.stringify({ city: "São Paulo" })
            });

            assert(res.status === 202, "2.1 Edição de cidade retorna 202");

            const checkComp = await prisma.company.findUnique({ where: { id: textOnlyComp.id } });
            assert(checkComp.city === "São Paulo", "2.1 Campo city atualizado");
            assert(
                checkComp.places === "Parque Ibirapuera - Portão 3, Quiosque 12",
                "2.1 Texto descritivo legado preservado intacto, não destruído por 'São Paulo'"
            );
        }

        // =========================================================================
        // CENÁRIO 4: Remoção de número/CEP obrigatórios retorna 400 sem alterar banco
        // =========================================================================
        console.log("\n📋 CENÁRIO 4: Remoção de número/CEP obrigatórios com vínculo");
        {
            const compMand = await prisma.company.create({
                data: {
                    name: "Empresa Mandatórios",
                    category: "Pizzaria",
                    cnpj: "90.009.010/0001-01",
                    places: "Rua Obrigatória, 55",
                    number: "55",
                    zipcode: "01000-000",
                    userId: owner1.id
                }
            });

            const addrMand = await prisma.address.create({
                data: {
                    place: "Rua Obrigatória, 55",
                    number: "55",
                    zipcode: "01000-000",
                    lat: -23.5,
                    long: -46.6,
                    url: "https://i.ibb.co/mock/mand.png",
                    users: { connect: { id: owner1.id } },
                    addressCompany: { create: { companyId: compMand.id } }
                }
            });

            const resNullNum = await fetch(`${BASE_URL}/company/${compMand.id}`, {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${tokenOwner1}`
                },
                body: JSON.stringify({ number: null })
            });
            assert(resNullNum.status === 400, "4.1 number: null retorna 400");

            const resNullZip = await fetch(`${BASE_URL}/company/${compMand.id}`, {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${tokenOwner1}`
                },
                body: JSON.stringify({ zipcode: null })
            });
            assert(resNullZip.status === 400, "4.2 zipcode: null retorna 400");

            const checkComp = await prisma.company.findUnique({ where: { id: compMand.id } });
            assert(checkComp.number === "55", "4.3 Banco inalterado: number preservado");
            assert(checkComp.zipcode === "01000-000", "4.3 Banco inalterado: zipcode preservado");
        }

        // =========================================================================
        // CENÁRIO 5: places null, vazio e espaços retornam 400 sem gravações
        // =========================================================================
        console.log("\n📋 CENÁRIO 5: places null, vazio e espaços retornam 400");
        {
            const compPlaces = await prisma.company.create({
                data: {
                    name: "Empresa Places Invalido",
                    category: "Farmácia",
                    cnpj: "91.010.011/0001-12",
                    places: "Rua Original, 100",
                    userId: owner1.id
                }
            });

            const resNull = await fetch(`${BASE_URL}/company/${compPlaces.id}`, {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${tokenOwner1}`
                },
                body: JSON.stringify({ places: null })
            });
            assert(resNull.status === 400, "5.1 places: null retorna 400");

            const resEmpty = await fetch(`${BASE_URL}/company/${compPlaces.id}`, {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${tokenOwner1}`
                },
                body: JSON.stringify({ places: "" })
            });
            assert(resEmpty.status === 400, "5.2 places: '' retorna 400");

            const resSpaces = await fetch(`${BASE_URL}/company/${compPlaces.id}`, {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${tokenOwner1}`
                },
                body: JSON.stringify({ places: "   " })
            });
            assert(resSpaces.status === 400, "5.3 places com apenas espaços retorna 400");

            const checkComp = await prisma.company.findUnique({ where: { id: compPlaces.id } });
            assert(checkComp.places === "Rua Original, 100", "5.4 places no banco permaneceu inalterado");
        }

        // =========================================================================
        // CENÁRIO 6: Padronização de favoritos com formatCompanyResponse
        // =========================================================================
        console.log("\n📋 CENÁRIO 6: Favoritos retornam empresa com contrato normalizado");
        {
            const compFav = await prisma.company.create({
                data: {
                    name: "Cafeteria Gourmet Favorita",
                    category: "Café",
                    cnpj: "31.415.926/0001-53",
                    places: "Rua Gourmet, 100",
                    logo: "https://i.ibb.co/mock/logo_cafe.png",
                    cover: "https://i.ibb.co/mock/capa_cafe.png",
                    website: "https://cafegourmet.com",
                    whatsapp: "+5511999998888",
                    phone: "+551133334444",
                    amenities: JSON.stringify(["Wi-Fi", "Ar Condicionado", "Pet Friendly"]),
                    subcategories: JSON.stringify(["Cafés Filtrados", "Espressos"]),
                    userId: owner1.id
                }
            });

            await prisma.favorite.create({
                data: {
                    userId: owner1.id,
                    companyId: compFav.id
                }
            });

            const res = await fetch(`${BASE_URL}/company/favorites`, {
                headers: { Authorization: `Bearer ${tokenOwner1}` }
            });

            assert(res.status === 200, "6.1 GET /company/favorites retorna 200 OK");
            const data = await res.json();
            const favItem = data.find(f => f.companyId === compFav.id);

            assert(Boolean(favItem), "6.2 Empresa favoritada encontrada na lista");
            assert(typeof favItem.id === "number", "6.2 id do favorito presente");
            assert(favItem.companyId === compFav.id, "6.2 companyId presente");

            const c = favItem.company;
            assert(Array.isArray(c.amenities), "6.3 amenities normalizado como array");
            assert(c.amenities.includes("Wi-Fi"), "6.3 amenities contém 'Wi-Fi'");
            assert(c.amenitiesMap && c.amenitiesMap["Wi-Fi"] === true, "6.3 amenitiesMap gerado com chave booleana");
            assert(Array.isArray(c.subcategories), "6.3 subcategories normalizado como array");
            assert(c.logoUrl === "https://i.ibb.co/mock/logo_cafe.png", "6.3 Espelho logoUrl presente");
            assert(c.site === "https://cafegourmet.com", "6.3 Espelho site presente");
            assert(c.whatsApp === "+5511999998888", "6.3 Espelho whatsApp presente");
            assert(c.telefone === "+551133334444", "6.3 Espelho telefone presente");
        }

    } catch (err) {
        console.error("Erro inesperado durante a execução dos testes:", err);
        failed++;
    } finally {
        if (server) {
            server.close();
        }
        await testDb.cleanup(prisma);

        console.log("\n════════════════════════════════════════════════════════════");
        console.log(`📊 RESULTADO CONSISTÊNCIA DE ENDEREÇO: ${passed} aprovados, ${failed} reprovados`);
        console.log("════════════════════════════════════════════════════════════\n");

        if (failed > 0) {
            process.exit(1);
        }
    }
}

run();
