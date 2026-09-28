/**
 * Testes automatizados — Etapa 1: Autenticação, Permissões e Exposição de Dados
 *
 * Execução: node testes/etapa1.test.js
 *
 * IMPORTANTE: Este script inicia o servidor na porta 4444 usando um banco
 * SQLite de teste isolado. Não usa banco de produção ou contas reais.
 * Não chama npm start (que aplicaria migrações no banco principal).
 */

import { setupTestDatabase } from './helpers/testDb.js';

// Inicializa banco temporário antes de qualquer import do Prisma
const testDb = await setupTestDatabase();

const { default: prisma } = await import('../src/utils/prisma.js');
const { default: app } = await import('../src/app.js');
const { default: jwt } = await import('jsonwebtoken');
const { default: bcrypt } = await import('bcrypt');

const BASE_URL = 'http://localhost:4444';
const JWT_SECRET = process.env.JWT_SECRET;

let passed = 0;
let failed = 0;
let skipped = 0;
const failures = [];

function assert(condition, testName) {
    if (condition) {
        console.log(`  ✅ ${testName}`);
        passed++;
    } else {
        console.log(`  ❌ ${testName}`);
        failed++;
        failures.push(testName);
    }
}

async function request(method, path, { body, token } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const opts = { method, headers };
    if (body) opts.body = JSON.stringify(body);

    const res = await fetch(`${BASE_URL}${path}`, opts);
    let data;
    try {
        data = await res.json();
    } catch {
        data = null;
    }
    return { status: res.status, data };
}

// ─── Setup: limpar e preparar dados de teste ────────────────────────

async function cleanup() {
    // Limpar na ordem correta (FK constraints)
    await prisma.payment.deleteMany({});
    await prisma.favorite.deleteMany({});
    await prisma.addressCompany.deleteMany({});
    await prisma.company.deleteMany({});
    await prisma.address.deleteMany({});
    await prisma.user.deleteMany({});
}

// ─── Testes ─────────────────────────────────────────────────────────

async function runTests() {
    console.log('\n🧹 Limpando banco de teste...');
    await cleanup();

    // ════════════════════════════════════════════════════════════════
    // SEÇÃO 1: Cadastro de Usuários
    // ════════════════════════════════════════════════════════════════
    console.log('\n📋 SEÇÃO 1: Cadastro de Usuários\n');

    // 1.1 Cadastro de client com sucesso
    const clientRes = await request('POST', '/user', {
        body: {
            name: 'Teste Cliente',
            email: 'cliente@teste.com',
            password: 'Senh@Forte123',
            type: 'client'
        }
    });
    assert(clientRes.status === 201, '1.1 Cadastro de client retorna 201');
    assert(clientRes.data?.token, '1.1 Cadastro de client retorna token');
    assert(clientRes.data?.user?.id, '1.1 Cadastro de client retorna user com id');
    assert(clientRes.data?.user?.password === undefined, '1.1 Cadastro de client NÃO retorna password');
    assert(clientRes.data?.message === 'Usuário criado com sucesso', '1.1 Mensagem de sucesso preservada');
    const clientToken = clientRes.data?.token;
    const clientId = clientRes.data?.user?.id;

    // 1.2 Cadastro de owner com sucesso
    const ownerRes = await request('POST', '/user', {
        body: {
            name: 'Teste Owner',
            email: 'owner@teste.com',
            password: 'Senh@Forte456',
            type: 'owner'
        }
    });
    assert(ownerRes.status === 201, '1.2 Cadastro de owner retorna 201');
    assert(ownerRes.data?.user?.password === undefined, '1.2 Cadastro de owner NÃO retorna password');
    const ownerToken = ownerRes.data?.token;
    const ownerId = ownerRes.data?.user?.id;

    // 1.3 Rejeição de cadastro admin
    const adminRes = await request('POST', '/user', {
        body: {
            name: 'Tentativa Admin',
            email: 'admin@teste.com',
            password: 'Senh@Forte789',
            type: 'admin'
        }
    });
    assert(adminRes.status === 400, '1.3 Cadastro de admin rejeitado com 400');
    const adminErrMsg = (adminRes.data?.error || '').toLowerCase();
    assert(adminErrMsg.includes('admin') || adminErrMsg.includes('cadastro') || adminErrMsg.includes('client') || adminErrMsg.includes('owner'),
        '1.3 Mensagem indica restrição de tipo no cadastro público');

    // 1.4 Rejeição de campos protegidos (signature)
    const sigRes = await request('POST', '/user', {
        body: {
            name: 'Teste Signature',
            email: 'sig@teste.com',
            password: 'Senh@Forte101',
            type: 'client',
            signature: 'PREMIUM'
        }
    });
    // O schema não aceita signature, então deve dar 201 com BASIC ou rejeitar
    if (sigRes.status === 201) {
        assert(sigRes.data?.user?.signature === 'BASIC',
            '1.4 signature ignorada — usuário criado com BASIC');
    } else {
        assert(sigRes.status === 400, '1.4 signature rejeitada com 400');
    }

    // 1.5 Rejeição de e-mail duplicado
    const dupRes = await request('POST', '/user', {
        body: {
            name: 'Duplicado',
            email: 'cliente@teste.com',
            password: 'Senh@Forte999',
            type: 'client'
        }
    });
    assert(dupRes.status === 409, '1.5 E-mail duplicado retorna 409');

    // 1.6 Campos obrigatórios ausentes
    const missingRes = await request('POST', '/user', {
        body: { name: 'Sem Email' }
    });
    assert(missingRes.status === 400, '1.6 Campos obrigatórios ausentes retorna 400');

    // ════════════════════════════════════════════════════════════════
    // SEÇÃO 2: Login
    // ════════════════════════════════════════════════════════════════
    console.log('\n📋 SEÇÃO 2: Login\n');

    // 2.1 Login correto
    const loginOk = await request('POST', '/user/login', {
        body: { email: 'cliente@teste.com', password: 'Senh@Forte123' }
    });
    assert(loginOk.status === 200, '2.1 Login correto retorna 200');
    assert(loginOk.data?.token, '2.1 Login retorna token');
    assert(loginOk.data?.user?.password === undefined, '2.1 Login NÃO retorna password');
    assert(loginOk.data?.message === 'Login realizado com sucesso', '2.1 Mensagem de login preservada');

    // 2.2 Login com senha errada
    const loginBad = await request('POST', '/user/login', {
        body: { email: 'cliente@teste.com', password: 'SenhaErrada123!' }
    });
    assert(loginBad.status === 401, '2.2 Senha errada retorna 401');

    // 2.3 Login com e-mail inexistente
    const loginNone = await request('POST', '/user/login', {
        body: { email: 'naoexiste@teste.com', password: 'Senh@Forte123' }
    });
    assert(loginNone.status === 401, '2.3 E-mail inexistente retorna 401');

    // 2.4 Login sem campos obrigatórios
    const loginEmpty = await request('POST', '/user/login', {
        body: { email: 'cliente@teste.com' }
    });
    assert(loginEmpty.status === 400, '2.4 Login sem senha retorna 400');

    // ════════════════════════════════════════════════════════════════
    // SEÇÃO 3: Autenticação JWT
    // ════════════════════════════════════════════════════════════════
    console.log('\n📋 SEÇÃO 3: Autenticação JWT\n');

    // 3.1 Token ausente
    const noToken = await request('GET', '/user');
    assert(noToken.status === 401, '3.1 Sem token retorna 401');

    // 3.2 Token inválido
    const badToken = await request('GET', '/user', { token: 'token-invalido' });
    assert(badToken.status === 401, '3.2 Token inválido retorna 401');

    // 3.3 Token com formato errado (sem Bearer)
    const noBearer = await fetch(`${BASE_URL}/user`, {
        headers: { 'Authorization': 'Basic abc123' }
    });
    assert(noBearer.status === 401, '3.3 Formato sem Bearer retorna 401');

    // 3.4 Token expirado
    const expiredToken = jwt.sign(
        { sub: clientId, type: 'client', email: 'cliente@teste.com', name: 'Teste' },
        JWT_SECRET,
        { expiresIn: '0s' }
    );
    // Pequena espera para garantir expiração
    await new Promise(r => setTimeout(r, 1100));
    const expiredRes = await request('GET', `/user/${clientId}`, { token: expiredToken });
    assert(expiredRes.status === 401, '3.4 Token expirado retorna 401');

    // 3.5 Token de usuário que não existe mais
    const ghostToken = jwt.sign(
        { sub: 99999, type: 'client', email: 'ghost@teste.com', name: 'Ghost' },
        JWT_SECRET,
        { expiresIn: '1d' }
    );
    const ghostRes = await request('GET', '/user/99999', { token: ghostToken });
    assert(ghostRes.status === 401, '3.5 Usuário inexistente (token válido) retorna 401');

    // ════════════════════════════════════════════════════════════════
    // SEÇÃO 4: Edição de Perfil
    // ════════════════════════════════════════════════════════════════
    console.log('\n📋 SEÇÃO 4: Edição de Perfil\n');

    // 4.1 Rejeição de type na edição
    const editType = await request('PUT', `/user/${clientId}`, {
        token: clientToken,
        body: { type: 'admin' }
    });
    assert(editType.status === 403, '4.1 Alterar type retorna 403');
    assert(editType.data?.error?.includes('type'), '4.1 Mensagem menciona type');

    // 4.2 Rejeição de signature na edição
    const editSig = await request('PUT', `/user/${clientId}`, {
        token: clientToken,
        body: { signature: 'PREMIUM' }
    });
    assert(editSig.status === 403, '4.2 Alterar signature retorna 403');
    assert(editSig.data?.error?.includes('signature'), '4.2 Mensagem menciona signature');

    // 4.3 Edição de nome com sucesso (campo permitido)
    const editName = await request('PUT', `/user/${clientId}`, {
        token: clientToken,
        body: { name: 'Nome Atualizado' }
    });
    assert(editName.status === 202, '4.3 Edição de nome retorna 202');
    assert(editName.data?.name === 'Nome Atualizado', '4.3 Nome atualizado corretamente');
    assert(editName.data?.password === undefined, '4.3 Edição NÃO retorna password');

    // 4.4 Um usuário não pode editar outro (não admin)
    const editOther = await request('PUT', `/user/${ownerId}`, {
        token: clientToken,
        body: { name: 'Intruso' }
    });
    assert(editOther.status === 403, '4.4 Client não pode editar outro usuário');

    // ════════════════════════════════════════════════════════════════
    // SEÇÃO 5: Consultas de Usuário (sem password)
    // ════════════════════════════════════════════════════════════════
    console.log('\n📋 SEÇÃO 5: Consultas de Usuário (sem password)\n');

    // Criar admin direto no banco para testes de listagem e admin
    const adminHash = await bcrypt.hash('AdminSenh@123', 10);
    const adminUser = await prisma.user.create({
        data: {
            name: 'Admin Teste',
            email: 'adminreal@teste.com',
            password: adminHash,
            type: 'admin'
        }
    });
    const adminLoginRes = await request('POST', '/user/login', {
        body: { email: 'adminreal@teste.com', password: 'AdminSenh@123' }
    });
    const adminToken = adminLoginRes.data?.token;

    // 5.1 Listagem por admin — sem passwords
    const listRes = await request('GET', '/user', { token: adminToken });
    assert(listRes.status === 200, '5.1 Admin lista usuários com 200');
    assert(Array.isArray(listRes.data), '5.1 Resposta é array');
    const hasPassword = listRes.data?.some(u => u.password !== undefined);
    assert(!hasPassword, '5.1 Nenhum usuário da lista tem campo password');

    // 5.2 Client não pode listar
    const clientList = await request('GET', '/user', { token: clientToken });
    assert(clientList.status === 403, '5.2 Client não pode listar usuários');

    // 5.3 Show user por admin — sem password
    const showRes = await request('GET', `/user/${clientId}`, { token: adminToken });
    assert(showRes.status === 200, '5.3 Admin consulta user com 200');
    assert(showRes.data?.password === undefined, '5.3 Show user NÃO retorna password');

    // 5.4 Show do próprio perfil
    const showSelf = await request('GET', `/user/${clientId}`, { token: clientToken });
    assert(showSelf.status === 200, '5.4 Client consulta próprio perfil com 200');
    assert(showSelf.data?.password === undefined, '5.4 Próprio perfil NÃO retorna password');

    // ════════════════════════════════════════════════════════════════
    // SEÇÃO 6: Pagamentos — Autorização por Empresa
    // ════════════════════════════════════════════════════════════════
    console.log('\n📋 SEÇÃO 6: Pagamentos — Autorização por Empresa\n');

    // Criar segundo owner
    const owner2Res = await request('POST', '/user', {
        body: {
            name: 'Owner Dois',
            email: 'owner2@teste.com',
            password: 'Senh@Forte222',
            type: 'owner'
        }
    });
    const owner2Token = owner2Res.data?.token;
    const owner2Id = owner2Res.data?.user?.id;

    // Criar empresas para os owners (precisa de auth no router)
    const company1Res = await request('POST', '/company', {
        token: ownerToken,
        body: {
            name: 'Empresa Owner Um',
            category: 'Restaurante',
            cnpj: '11222333000181',
            places: 'Rua Teste 123 Centro'
        }
    });
    const company1Id = company1Res.data?.id;

    const company2Res = await request('POST', '/company', {
        token: owner2Token,
        body: {
            name: 'Empresa Owner Dois',
            category: 'Lanchonete',
            cnpj: '11444777000161',
            places: 'Avenida Teste 456 Centro'
        }
    });
    const company2Id = company2Res.data?.id;

    // 6.1 Client rejeitado no módulo de pagamentos
    const clientPay = await request('GET', '/payment', { token: clientToken });
    assert(clientPay.status === 403, '6.1 Client rejeitado em GET /payment');

    const clientPayCreate = await request('POST', '/payment', {
        token: clientToken,
        body: {
            toDate: '2026-01-01T00:00:00Z',
            dueDate: '2026-02-01T00:00:00Z',
            paymentForm: 'Pix',
            advertising: 'Banner',
            key: 'chave-teste',
            type: 'mensal'
        }
    });
    assert(clientPayCreate.status === 403, '6.1 Client rejeitado em POST /payment');

    // 6.2 Owner cria pagamento (inferência de empresa única)
    const pay1Res = await request('POST', '/payment', {
        token: ownerToken,
        body: {
            toDate: '2026-01-01T00:00:00Z',
            dueDate: '2026-02-01T00:00:00Z',
            paymentForm: 'Pix',
            advertising: 'Banner principal',
            key: 'chave-pix-1',
            type: 'mensal'
        }
    });
    assert(pay1Res.status === 201, '6.2 Owner cria pagamento com 201');
    assert(pay1Res.data?.companyId === company1Id, '6.2 Pagamento vinculado à empresa correta');
    const payment1Id = pay1Res.data?.id;

    // 6.3 Owner2 cria pagamento
    const pay2Res = await request('POST', '/payment', {
        token: owner2Token,
        body: {
            toDate: '2026-03-01T00:00:00Z',
            dueDate: '2026-04-01T00:00:00Z',
            paymentForm: 'Boleto',
            advertising: 'Lateral',
            key: 'chave-boleto-2',
            type: 'trimestral'
        }
    });
    assert(pay2Res.status === 201, '6.3 Owner2 cria pagamento com 201');
    const payment2Id = pay2Res.data?.id;

    // 6.4 Owner A vê apenas seus pagamentos na listagem
    const owner1List = await request('GET', '/payment', { token: ownerToken });
    assert(owner1List.status === 200, '6.4 Owner1 lista pagamentos com 200');
    const onlyOwn = owner1List.data?.every(p => p.companyId === company1Id);
    assert(onlyOwn, '6.4 Listagem contém APENAS pagamentos do owner1');

    // 6.5 Owner A não consulta pagamento de owner B
    const showOther = await request('GET', `/payment/${payment2Id}`, { token: ownerToken });
    assert(showOther.status === 403, '6.5 Owner A não consulta pagamento de owner B');

    // 6.6 Owner A não edita pagamento de owner B
    const editOther2 = await request('PUT', `/payment/${payment2Id}`, {
        token: ownerToken,
        body: { paymentForm: 'Cartão' }
    });
    assert(editOther2.status === 403, '6.6 Owner A não edita pagamento de owner B');

    // 6.7 Owner A não deleta pagamento de owner B
    const delOther = await request('DELETE', `/payment/${payment2Id}`, { token: ownerToken });
    assert(delOther.status === 403, '6.7 Owner A não deleta pagamento de owner B');

    // 6.8 Owner edita próprio pagamento
    const editOwn = await request('PUT', `/payment/${payment1Id}`, {
        token: ownerToken,
        body: { paymentForm: 'Cartão' }
    });
    assert(editOwn.status === 202, '6.8 Owner edita próprio pagamento com 202');

    // 6.9 Admin consulta qualquer pagamento
    const adminShow = await request('GET', `/payment/${payment2Id}`, { token: adminToken });
    assert(adminShow.status === 200, '6.9 Admin consulta qualquer pagamento com 200');

    // 6.10 Admin lista todos os pagamentos
    const adminList = await request('GET', '/payment', { token: adminToken });
    assert(adminList.status === 200, '6.10 Admin lista pagamentos com 200');
    assert(adminList.data?.length >= 2, '6.10 Admin vê todos os pagamentos');

    // 6.11 Criação com empresa inválida
    const badCompany = await request('POST', '/payment', {
        token: ownerToken,
        body: {
            companyId: 99999,
            toDate: '2026-01-01T00:00:00Z',
            dueDate: '2026-02-01T00:00:00Z',
            paymentForm: 'Pix',
            advertising: 'Banner',
            key: 'chave-teste',
            type: 'mensal'
        }
    });
    assert(badCompany.status === 403 || badCompany.status === 404,
        '6.11 Empresa inválida rejeitada');

    // 6.12 Criação com empresa alheia
    const alienCompany = await request('POST', '/payment', {
        token: ownerToken,
        body: {
            companyId: company2Id,
            toDate: '2026-01-01T00:00:00Z',
            dueDate: '2026-02-01T00:00:00Z',
            paymentForm: 'Pix',
            advertising: 'Banner',
            key: 'chave-teste',
            type: 'mensal'
        }
    });
    assert(alienCompany.status === 403, '6.12 Empresa alheia rejeitada com 403');

    // 6.13 Owner sem empresa tenta criar pagamento
    const ownerNoCompanyRes = await request('POST', '/user', {
        body: {
            name: 'Owner Sem Empresa',
            email: 'ownersem@teste.com',
            password: 'Senh@Forte333',
            type: 'owner'
        }
    });
    const ownerNoCompanyToken = ownerNoCompanyRes.data?.token;
    const noCompanyPay = await request('POST', '/payment', {
        token: ownerNoCompanyToken,
        body: {
            toDate: '2026-01-01T00:00:00Z',
            dueDate: '2026-02-01T00:00:00Z',
            paymentForm: 'Pix',
            advertising: 'Banner',
            key: 'chave-teste',
            type: 'mensal'
        }
    });
    assert(noCompanyPay.status === 400, '6.13 Owner sem empresa retorna 400');

    // 6.14 Não é possível trocar companyId na edição
    const changeCompany = await request('PUT', `/payment/${payment1Id}`, {
        token: ownerToken,
        body: { companyId: company2Id }
    });
    assert(changeCompany.status === 400, '6.14 Trocar empresa de pagamento retorna 400');

    // 6.15 Admin cria pagamento informando empresa
    const adminCreate = await request('POST', '/payment', {
        token: adminToken,
        body: {
            companyId: company1Id,
            toDate: '2026-05-01T00:00:00Z',
            dueDate: '2026-06-01T00:00:00Z',
            paymentForm: 'Transferência',
            advertising: 'Topo',
            key: 'admin-key-1',
            type: 'anual'
        }
    });
    assert(adminCreate.status === 201, '6.15 Admin cria pagamento com 201');

    // 6.16 Admin sem companyId é rejeitado na criação
    const adminNoCompany = await request('POST', '/payment', {
        token: adminToken,
        body: {
            toDate: '2026-05-01T00:00:00Z',
            dueDate: '2026-06-01T00:00:00Z',
            paymentForm: 'Pix',
            advertising: 'Banner',
            key: 'chave-teste',
            type: 'mensal'
        }
    });
    assert(adminNoCompany.status === 400, '6.16 Admin sem companyId retorna 400');

    // 6.17 Owner com múltiplas empresas sem companyId
    // Criar segunda empresa para owner1 (CNPJ matematicamente válido)
    const company3Res = await request('POST', '/company', {
        token: ownerToken,
        body: {
            name: 'Segunda Empresa Owner Um',
            category: 'Bar',
            cnpj: '97837181000147',
            places: 'Praça Central 789 Centro'
        }
    });
    assert(company3Res.status === 201, '6.17 Pré-condição: segunda empresa criada para owner1');

    const multiPay = await request('POST', '/payment', {
        token: ownerToken,
        body: {
            toDate: '2026-01-01T00:00:00Z',
            dueDate: '2026-02-01T00:00:00Z',
            paymentForm: 'Pix',
            advertising: 'Banner',
            key: 'chave-teste',
            type: 'mensal'
        }
    });
    assert(multiPay.status === 400, '6.17 Owner com múltiplas empresas sem companyId retorna 400');
    assert(multiPay.data?.error?.includes('companyId') || multiPay.data?.error?.includes('empresa'),
        '6.17 Mensagem pede seleção explícita');

    // 6.18 Owner deleta próprio pagamento
    const delOwn = await request('DELETE', `/payment/${payment1Id}`, { token: ownerToken });
    assert(delOwn.status === 200, '6.18 Owner deleta próprio pagamento com 200');

    // ════════════════════════════════════════════════════════════════
    // SEÇÃO 7: Admin edita usuário (campo permitido por admin)
    // ════════════════════════════════════════════════════════════════
    console.log('\n📋 SEÇÃO 7: Admin edita usuário (preservado)\n');

    // 7.1 Admin edita nome de outro usuário
    const adminEdit = await request('PUT', `/user/${clientId}`, {
        token: adminToken,
        body: { name: 'Editado Pelo Admin' }
    });
    assert(adminEdit.status === 202, '7.1 Admin edita nome de outro usuário com 202');
    assert(adminEdit.data?.password === undefined, '7.1 Admin edit NÃO retorna password');

    // 7.2 Mesmo admin é bloqueado ao tentar alterar type
    const adminEditType = await request('PUT', `/user/${clientId}`, {
        token: adminToken,
        body: { type: 'admin' }
    });
    assert(adminEditType.status === 403, '7.2 Admin também bloqueado de alterar type via perfil');

    // ════════════════════════════════════════════════════════════════
    // Resumo
    // ════════════════════════════════════════════════════════════════
    console.log('\n' + '═'.repeat(60));
    console.log(`📊 RESULTADO: ${passed} aprovados, ${failed} reprovados, ${skipped} pulados`);
    if (failures.length > 0) {
        console.log('\n❌ Testes reprovados:');
        failures.forEach(f => console.log(`   - ${f}`));
    }
    await cleanup();
    await prisma.$disconnect();
}

// ─── Iniciar servidor de teste usando o app real da aplicação ──────

const server = app.listen(4444, () => {
    console.log('🧪 Servidor de teste rodando na porta 4444');
    console.log(`🗄️  Banco temporário exclusivo: ${testDb.dbUrl}`);
});

try {
    await runTests();
} catch (error) {
    console.error('\n💥 Erro fatal nos testes:', error);
} finally {
    server.close();
    await testDb.cleanup(prisma);
    process.exit(failed > 0 ? 1 : 0);
}
