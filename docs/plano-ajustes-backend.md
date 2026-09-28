# Plano de Ajustes — Backend Voyage

## Etapa 1: Autenticação, Permissões e Exposição de Dados

### Objetivo
Corrigir vulnerabilidades de autenticação, autorização e exposição de dados
sensíveis, preservando a integração existente com o frontend React/Vite.

### Checklist de Correções

- [x] **JWT_SECRET centralizado** — remover fallback hardcoded; falhar ao iniciar se ausente
- [x] **PrismaClient singleton** — eliminar múltiplas instâncias
- [x] **Sanitização de usuário** — nunca retornar password/hash em respostas HTTP
- [x] **Cadastro protegido** — whitelist de campos; bloquear admin no cadastro público
- [x] **Edição de perfil protegida** — bloquear type/signature; rejeitar com erro claro
- [x] **Auth middleware reforçado** — verificar existência do usuário no banco; usar perfil atual
- [x] **Pagamentos protegidos** — verificar empresa proprietária em todas as operações
- [x] **Criar .env.example** — sem segredos reais
- [x] **Testes automatizados** — cobertura dos cenários de segurança

### Contratos Afetados

| Rota | Mudança | Impacto no Frontend |
|------|---------|---------------------|
| `POST /user` | Campo `password` removido da resposta; `type: "admin"` rejeitado | Frontend não deve enviar type=admin no cadastro |
| `PUT /user/:id` | `type` e `signature` rejeitados com erro 403 | Frontend não deve tentar alterar esses campos |
| `GET /user`, `GET /user/:id` | Campo `password` removido das respostas | Nenhum — frontend não usa hash de senha |
| `POST /user/login` | Campo `password` já não retornava | Nenhum |
| `POST /payment` | Validação de empresa proprietária; status 400/403 em vez de 402 | Frontend deve tratar esses status |
| `GET /payment` | Filtro de propriedade aplicado no servidor | Owner vê apenas seus pagamentos |
| `GET/PUT/DELETE /payment/:id` | Verificação de propriedade | Owner não acessa pagamentos alheios |

### Verificações Executadas

- [x] Testes automatizados executados (67/67 aprovados em `testes/etapa1.test.js`)
- [ ] Verificação manual com frontend (bloqueada — workspace do frontend fora do escopo de acesso)

### Arquivos Criados

| Arquivo | Propósito |
|---------|-----------|
| `src/utils/config.js` | Configuração centralizada do JWT_SECRET |
| `src/utils/prisma.js` | Singleton do PrismaClient |
| `src/utils/sanitize.js` | Sanitização de campos sensíveis do User |
| `.env.example` | Template de variáveis de ambiente |
| `testes/etapa1.test.js` | Testes automatizados da etapa 1 |
| `docs/plano-ajustes-backend.md` | Este documento |

### Arquivos Alterados

| Arquivo | Alterações |
|---------|------------|
| `src/server.js` | Validação de JWT_SECRET na inicialização |
| `src/middlewares/auth.js` | Config centralizada; verificação de existência no banco |
| `src/services/user.js` | Cadastro protegido; edição protegida; sanitização |
| `src/services/payment.js` | Autorização por empresa em todas as operações |
| `src/services/company.js` | Usa prisma singleton |
| `src/services/address.js` | Usa prisma singleton |
| `src/utils/save.js` | Usa prisma singleton |
| `.env` | Adicionada JWT_SECRET |

---

## Etapa 2: Endereços, Uploads e Alinhamento de Perfil de Company

### Objetivo
Proteger a privacidade de endereços pessoais (tanto na listagem quanto na busca por ID), garantindo que consultas públicas divulguem estritamente endereços comerciais; restringir consultas ao filtro de favoritos ao usuário autenticado dono dos favoritos; validar a decodificação real e limites dimensionais de arquivos de imagem para impedir uploads de arquivos truncados ou arbitrários disfarçados; expandir os campos e relacionamentos de perfil de Company (`description`, `phone`, `email`, `openingHours`, `logo`, `whatsapp`, `instagram`, `website`, `cover`, `amenities`, `subcategories`, endereço estruturado) com migrações não-destrutivas que preservam dados legados; bloquear manipulação arbitrária de `evaluate` por usuários comuns; implementar adaptadores bidirecionais de contratos; permitir limpeza explícita de campos opcionais sem perda por omissão; e manter utilitários (`attachSave`) e upload de imagens resilientes.

### Checklist de Correções

- [x] **Restauração de validação Zod explícita em `editCompany`** —
  - Criação e edição agora compartilham as mesmas regras base de campos, formatos, limites máximos e validações (ex: regex de telefone, CNPJ com checksum, limite de 500 caracteres em descrição).
  - Na edição, campos omitidos (`undefined`) mantêm seus valores atuais; campos enviados com `null` ou `""` são limpos explicitamente no banco; e formatos inválidos ou objetos arbitrários são rejeitados com `400 Bad Request` sem qualquer conversão implícita.
- [x] **Atualização parcial de endereço e recálculo inteligente de `places`** —
  - Antes de recalcular o endereço descritivo (`places`), o backend mescla os campos recebidos com os dados atuais salvos no banco.
  - Alterar apenas a cidade (`cidade`) preserva a rua, número e bairro atuais no banco e no campo descritivo `places`.
  - Trata remoção explícita de campos estruturados (ex: `number: null`), recalculando o logradouro sem quebrar a consistência.
- [x] **Definição da fonte principal do endereço comercial e sincronização transacional** —
  - **Fonte Principal:** A entidade `Address` é a autoridade central para dados de geolocalização física (`lat`, `long`, `url`, etc.). Os campos de endereço em `Company` representam a visão direta da sede no perfil da loja.
  - **Sincronização em Transação (`prisma.$transaction`)**:
    - Ao atualizar o endereço via `PUT /company/:id`: se a empresa tiver 1 endereço comercial vinculado em `AddressCompany`, ele é sincronizado atomicamente no banco. Se a empresa possuir **múltiplos endereços vinculados**, o sistema exige a identificação explícita do endereço editado via `addressId` (rejeitando com `400 Bad Request` se ausente ou não pertencente à empresa).
    - Ao atualizar via `PUT /address/:id`: empresas comerciais vinculadas recebem a atualização espelhada atomicamente.
- [x] **Contrato tipado para `amenities` e `subcategories`** —
  - Suporta tanto array de strings quanto **objeto de booleanos** (`{ wifi: true, arCondicionado: true, petFriendly: false }`), formato comumente emitido por formulários de checkboxes no frontend.
  - Extrai as comodidades ativas (`true`), valida que todos os valores são booleanos válidos e serializa para JSON estável no SQLite **sem gravar `"[object Object]"` ou JSON corrompido**.
  - Rejeita com `400 Bad Request` formatos inválidos (ex: números primitivos, strings em valores de objeto, arrays com não-strings).
  - Em `formatCompanyResponse`, entrega tanto o array estável `amenities` quanto o mapa `amenitiesMap`.
- [x] **Validação profunda de imagens com decodificação real de pixels via `Sharp`** —
  - Substituída a verificação manual de cabeçalho pela biblioteca nativa `Sharp` (libvips).
  - Força a decodificação da matriz completa de pixels (`.raw().toBuffer()`), identificando instantaneamente imagens com cabeçalho válido mas com fluxo de dados truncado ou sem dados de pixels (ex: PNG sem chunk `IDAT`).
  - Aplica limites de resolução (entre 1x1 e 8000x8000 pixels) e rejeita arquivos corrompidos com `400 Bad Request`.
  - Preserva a autorização e validação de posse da empresa antes de qualquer envio ao provedor de upload (`uploader.js`).
- [x] **Proteção estrita de endereços pessoais em `GET /address` e `GET /address/:id`** —
  - `GET /address` público retorna exclusivamente endereços comerciais vinculados a empresas (`addressCompany: { some: ... }`).
  - Parâmetros `?user=` ou `?company=` não contornam a política: mesmo filtrando por `user`, apenas endereços comerciais daquele usuário são expostos.
  - `GET /address/:id` público para endereço pessoal retorna `404 Not Found`. Somente o próprio dono autenticado (`req.logged.id === address.userId`) ou um `admin` conseguem consultar endereços pessoais. Consultas públicas a endereços comerciais continuam retornando `200 OK`.
- [x] **Restrição do filtro de favoritos (`GET /address?favorite=...`) ao usuário autenticado** —
  - Visitantes não autenticados recebem `401 Unauthorized` se tentarem usar o parâmetro `favorite`.
  - Usuários autenticados que tentarem filtrar pelos favoritos de outra conta recebem `403 Forbidden`. Administradores têm permissão de auditoria.
- [x] **Bloqueio de `evaluate` na criação e edição comuns de Company** —
  - Na criação (`POST /company`), usuários comuns que enviarem `evaluate` recebem `403 Forbidden`. O servidor define o valor padrão inicial (`0.0`).
  - Na edição (`PUT /company/:id`), usuários comuns que enviarem `evaluate` recebem `403 Forbidden`. Apenas administradores podem moderar notas.
- [x] **`POST /address` protegido com autenticação e validação de posse pré-upload** —
  - Exige token JWT válido (`auth`).
  - Ao vincular `companyId`, valida posse da empresa antes de acionar o provedor de upload (`uploader.js`).
- [x] **Vínculo automático com criador do endereço** —
  - Conecta `users: { connect: { id: req.logged.id } }` no momento da criação.
- [x] **Privacidade e seleção explícita de campos em Address** —
  - Remoção completa de `users`, `password`, `cpf`, `phone` da resposta pública.
- [x] **Multer seguro com limite de 5MB** —
  - Limite de 5MB com mensagem padronizada em caso de excesso.
- [x] **`attachSave` robusto** —
  - Filtra relacionamentos e timestamps antes do `prisma.update`.

### Contratos e Campos: Status de Persistência e Integração

| Recurso | Campo / Propriedade | Status do Contrato (Backend) | Integração Frontend | Observações / Adaptadores |
|---------|---------------------|------------------------------|---------------------|---------------------------|
| **Company** | `id` | ✅ Implementado | ⏳ Pendente de Teste em UI* | Chave primária autoincrement |
| **Company** | `name` | ✅ Implementado | ⏳ Pendente de Teste em UI* | Zod: min(3), max(100). Rejeita vazio na criação e na edição |
| **Company** | `category` | ✅ Implementado | ⏳ Pendente de Teste em UI* | Validado com enum canônico de categorias |
| **Company** | `cnpj` | ✅ Implementado | ⏳ Pendente de Teste em UI* | Validado com algoritmo oficial de 14 dígitos e checksum |
| **Company** | `evaluate` | ✅ Implementado | ⏳ Pendente de Teste em UI* | Definido pelo servidor (0.0). Bloqueado para edição comum (403) |
| **Company** | `places` | ✅ Implementado | ⏳ Pendente de Teste em UI* | Recalculado preservando dados existentes na edição parcial |
| **Company** | `userId` | ✅ Implementado | ⏳ Pendente de Teste em UI* | ID do proprietário da empresa |
| **Company** | `description` | ✅ Implementado | ⏳ Pendente de Teste em UI* | Zod: max(500) |
| **Company** | `phone` | ✅ Implementado | ⏳ Pendente de Teste em UI* | Zod: regex internacional/nacional |
| **Company** | `email` | ✅ Implementado | ⏳ Pendente de Teste em UI* | Zod: email format, max(100) |
| **Company** | `whatsapp` | ✅ Implementado | ⏳ Pendente de Teste em UI* | Adaptador: aceita `whatsApp` e `whatsapp` |
| **Company** | `instagram` | ✅ Implementado | ⏳ Pendente de Teste em UI* | Adaptador: aceita `insta`, `instagramUrl` e `instagram` |
| **Company** | `website` | ✅ Implementado | ⏳ Pendente de Teste em UI* | Adaptador: aceita `site`, `siteUrl` e `website` |
| **Company** | `openingHours` | ✅ Implementado | ⏳ Pendente de Teste em UI* | Horário textual descritivo (não equivalente a horários estruturados) |
| **Company** | `logo` | ✅ Implementado | ⏳ Pendente de Teste em UI* | Adaptador: aceita e responde com `logo` e `logoUrl` |
| **Company** | `cover` | ✅ Implementado | ⏳ Pendente de Teste em UI* | Adaptador: aceita e responde com `cover`, `capa` e `coverUrl` |
| **Company** | `amenities` | ✅ Implementado | ⏳ Pendente de Teste em UI* | Aceita array de strings ou mapa booleano; devolve array e mapa |
| **Company** | `subcategories` | ✅ Implementado | ⏳ Pendente de Teste em UI* | Aceita array de strings; devolve array |
| **Company** | Endereço Estruturado (`street`, `number`, `neighborhood`, `city`, `state`, `complement`, `zipcode`) | ✅ Implementado | ⏳ Pendente de Teste em UI* | Sincronizado em transação com Address |
| **Company** | `addressCompany` | ✅ Implementado | ⏳ Pendente de Teste em UI* | Relação NxM entre Company e Address |
| **Company** | `products` | ⏳ Não iniciado | ⏳ Não iniciado | Escopo de entregas futuras (não iniciado) |
| **Company** | `promotions` | ⏳ Não iniciado | ⏳ Não iniciado | Escopo de entregas futuras (não iniciado) |
| **Company** | `dailyMenu` | ⏳ Não iniciado | ⏳ Não iniciado | Escopo de entregas futuras (não iniciado) |
| **Address** | `id`, `place`, `number`, `zipcode`, `lat`, `long`, `url` | ✅ Implementado | ⏳ Pendente de Teste em UI* | Dados de localização geográfica e foto de fachada |
| **Address** | Endereço Estruturado (`street`, `neighborhood`, `city`, `state`, `complement`) | ✅ Implementado | ⏳ Pendente de Teste em UI* | Campos estruturados sincronizados com Company |
| **Address** | `users` | 🔒 Oculto | 🔒 Oculto | Oculto em consultas públicas para proteger privacidade |

> **\*Nota de Distinção:** Os contratos acima estão totalmente implementados, adaptados e validados no backend. O workspace do frontend (`voyagefrontend`) está fora dos limites de diretório autorizados no ambiente, de modo que a integração visual em tela é mantida formalmente como **Pendente de Teste em UI**.

### Verificações Executadas

- [x] **Bateria completa da Etapa 2** (`testes/etapa2.test.js`):
  - **147/147 testes aprovados** em banco temporário isolado.
  - Cobre:
    - Validação Zod explícita em criação e edição (nome vazio, categoria inexistente, descrição > 500, telefone inválido, rejeição de objetos arbitrários).
    - Atualização parcial de endereço e recálculo inteligente de `places` preservando rua, número e bairro ao alterar apenas a cidade.
    - Sincronização atômica em transação entre `Company` e `Address` (atualização por Company, atualização por Address e exigência de `addressId` para múltiplos endereços vinculados).
    - Contrato tipado de `amenities` (suporte a objeto de booleanos do frontend sem gravar `[object Object]`, array estável, e rejeição de formatos inválidos).
    - Decodificação real de pixels via `Sharp` (PNG sem IDAT, JPEG truncado, limites dimensionais de 8000x8000 e imagens válidas).
    - Proteção estrita de endereços pessoais, restrição de favoritos e bloqueio de `evaluate`.
- [x] **Teste de migração sobre dados legados** (`testes/migration_dados_antigos.test.js`):
  - **39/39 testes aprovados** com preservação integral de dados.
- [x] **Testes de Regressão de Segurança** (`testes/regressao_seguranca.test.js`):
  - **22/22 testes aprovados**.
- [x] **Baterias das demais etapas**:
  - `testes/etapa1.test.js`: **67/67 aprovados**.
  - `testes/etapa3.test.js`: **39/39 aprovados**.
  - `testes/etapa4.test.js`: **29/29 aprovados**.
  - `testes/etapa5.test.js`: **12/12 aprovados**.
  - **Total:** 355 testes automatizados aprovados (0 falhas).

---

## Etapa 3: Contratos e Robustez de Company

### Objetivo
Proteger as rotas de criação, edição e exclusão de empresas com autenticação (`auth`), adicionar blocos `try/catch` em todas as rotas para blindagem contra crashes de servidor (`UnhandledPromiseRejection`), garantir integridade referencial sem deletar pagamentos silenciosamente (rejeitar exclusão de empresas que possuam pagamentos com erro claro de histórico financeiro), executar deleções permitidas em transação atômica (`$transaction`) e padronizar retornos 404.

### Checklist de Correções

- [x] **Middleware `auth` adicionado às rotas de escrita** — `POST /company`, `PUT /company/:id` e `DELETE /company/:id` agora exigem autenticação obrigatória via token JWT.
- [x] **Blindagem com `try/catch`** — adicionado tratamento de exceções em `showCompany`, `deleteCompany`, `editCompany` e `createCompany`.
- [x] **Rejeição de exclusão com pagamentos** — verificação prévia de pagamentos vinculados (`prisma.payment.count`). Se houver registros, a exclusão é rejeitada com status `400 Bad Request` para proteger o histórico financeiro e fiscal.
- [x] **Transação atômica em deleções permitidas** — exclusão de `addressCompany`, `favorite` e `company` envelopada em `prisma.$transaction`.
- [x] **Autorização em edição e exclusão** — apenas o proprietário da empresa (`c.userId === req.logged.id`) ou um administrador (`admin`) têm permissão para alterar ou deletar a empresa.
- [x] **Validação e sanitização de IDs** — IDs não numéricos recebem `400 Bad Request` seguro.
- [x] **Padronização de respostas 404** — retorno em formato JSON estruturado `{ error: "Empresa com id ${id} não encontrada." }`.
- [x] **Validação matemática de CNPJ e unicidade** — preservada validação de dígitos e status `409 Conflict` caso o CNPJ já pertença a outra empresa.

### Implementação
- `src/services/company.js`:
  - `deleteCompany`: consulta `prisma.payment.count({ where: { companyId: id } })`. Se > 0, rejeita com erro descritivo `{ error: "Não é possível excluir esta empresa pois existem registros de pagamentos vinculados a ela." }`. Caso não haja pagamentos, deleta dependências permitidas (`addressCompany`, `favorite`) e a própria empresa dentro de `prisma.$transaction(async (tx) => ...)`.
  - Tratamento com `try/catch` abrangente em todas as ações de Company.
- `src/routes/company.js`: middlewares `auth` aplicados em POST, PUT e DELETE.

### Verificação
- [x] **Testes de Regressão de Segurança** (`testes/regressao_seguranca.test.js`):
  - Tentativa de exclusão de empresa com pagamentos rejeitada com status 400.
  - Confirmação de que pagamentos e empresa permanecem íntegros no banco.
  - Exclusão permitida de empresa sem pagamentos executada atomicamente limpando favoritos e endereços vinculados.
- [x] **Testes automatizados da Etapa 3** (`testes/etapa3.test.js`):
  - 39/39 testes aprovados em banco temporário exclusivo.

---

## Etapa 4: Regras de Negócio e Relacionamentos

### Objetivo
Garantir consistência cronológica em datas de pagamentos (`dueDate >= toDate`), corrigir a busca e filtros por data em `readPayment` (suportando `to_date`/`due_date` e `toDate`/`dueDate` com operadores corretos), validar a combinação de múltiplos filtros em `readAddress` (`category` + `favorite`), e implementar o ciclo de vida completo e unicidade de favoritos (`Favorite`) a nível de aplicação.

### Checklist de Correções

- [x] **Consistência cronológica de pagamentos** — rejeita criação ou edição onde a data de vencimento (`dueDate`) seja anterior à data inicial (`toDate`) com status `400 Bad Request`.
- [x] **Filtros de data corrigidos em `readPayment`** — substituída a cláusula invertida `{ lt: to_date, gt: due_date }` por operadores consistentes (`toDate: { gte: parsedToDate }`, `dueDate: { lte: parsedDueDate }`), aceitando tanto snake_case quanto camelCase.
- [x] **Validação de datas em queries** — formatos inválidos de datas ou `to_date > due_date` retornam `400 Bad Request` em vez de falhas internas no Prisma.
- [x] **Garantia de unicidade de favoritos** — `POST /company/:id/favorite` impede duplicações retornando `409 Conflict` se a empresa já estiver favoritada pelo usuário.
- [x] **Gerenciamento de favoritos** — endpoints para favoritar (`POST /company/:id/favorite`), desfavoritar (`DELETE /company/:id/favorite`) e listar favoritos (`GET /company/favorites`).
- [x] **Combinação de filtros em `readAddress`** — filtros simultâneos de categoria de empresa e favoritos combinam via `AND: companyConditions` sem sobreposição.
- [x] **Testes automatizados da Etapa 4** — 29/29 testes aprovados em `testes/etapa4.test.js`.

### Contratos Afetados

| Rota | Mudança | Impacto no Frontend |
|------|---------|---------------------|
| `POST /payment` | Validação `dueDate >= toDate` | Impede cadastro de vencimento anterior ao início |
| `PUT /payment/:id` | Validação `dueDate >= toDate` contra valores novos e existentes | Impede inconsistência cronológica na atualização |
| `GET /payment` | Aceita `to_date`/`toDate` e `due_date`/`dueDate` com filtros corretos | Permite consultas históricas por período de data |
| `POST /company/:id/favorite` | Endpoint para favoritar empresa (exige `auth`) | Permite ao usuário salvar empresas favoritas (rejeita duplicatas com 409) |
| `DELETE /company/:id/favorite` | Endpoint para desfavoritar empresa (exige `auth`) | Permite ao usuário remover dos favoritos |
| `GET /company/favorites` | Retorna lista de empresas favoritadas pelo usuário logado | Exibe os favoritos na interface do cliente |

### Verificações Executadas

- [x] Testes automatizados da Etapa 4 executados (29/29 aprovados em `testes/etapa4.test.js`)
- [x] Testes de regressão das Etapas 1, 2 e 3 re-executados (160/160 aprovados)
- [x] Total acumulado: 189/189 testes aprovados (100% de sucesso)

### Arquivos Alterados (Etapa 4)

| Arquivo | Alterações |
|---------|------------|
| `src/routes/payment.js` | Middleware `auth` adicionado em todas as rotas diretamente no router |
| `src/routes/company.js` | Endpoints de favoritos `/favorites`, `/:id/favorite` vinculados |
| `src/services/payment.js` | Refine cronológico no schema, filtros de período em readPayment, validação em editPayment |
| `src/services/company.js` | Implementadas funções `favoriteCompany`, `unfavoriteCompany` e `listUserFavorites` com unicidade |
| `src/server.js` | Montagem limpa de routers sem auth redundante no express |

---

## Etapa 5: Infraestrutura e Produção

### Objetivo
Configurar proteções de nível de rede e transporte: política de CORS controlada por whitelist configurável via variáveis de ambiente, rate limiting contra ataques de força bruta no login e cadastros abusivos (`express-rate-limit`), inclusão de cabeçalhos de segurança HTTP essenciais (`nosniff`, `DENY`, `X-XSS-Protection`), e garantia de integridade estrutural para ambiente produtivo.

### Checklist de Correções

- [x] **CORS configurável e seguro** — criado `src/utils/cors.js`, permitindo origens estritas via `CORS_ORIGIN` com fallback flexível para desenvolvimento local.
- [x] **Rate limiting no login** — limitador de 10 requisições por 15 minutos em `POST /user/login`, mitigando ataques de força bruta contra senhas.
- [x] **Rate limiting no cadastro** — limitador de 20 cadastros por hora em `POST /user`, mitigando spam e robôs.
- [x] **Cabeçalhos HTTP defensivos** — middleware `securityHeaders` aplicando `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `X-XSS-Protection: 1; mode=block` e `Referrer-Policy: strict-origin-when-cross-origin`.
- [x] **Variáveis de ambiente documentadas** — `.env.example` atualizado com `CORS_ORIGIN`, `NODE_ENV`, `PORT` e `JWT_SECRET`.
- [x] **Testes automatizados da Etapa 5** — 12/12 testes aprovados em `testes/etapa5.test.js`.

### Contratos Afetados

| Recurso | Mudança | Impacto no Frontend |
|---------|---------|---------------------|
| `POST /user/login` | Limite de 10 tentativas a cada 15 min | Retorna `429 Too Many Requests` se o limite de tentativas for violado |
| `POST /user` | Limite de 20 cadastros por hora | Retorna `429 Too Many Requests` se houver criação massiva de contas |
| CORS | Respeita variável `CORS_ORIGIN` | Em produção, domínios do frontend devem estar listados no `.env` |
| Headers | Cabeçalhos de segurança em todas as respostas HTTP | Protege o cliente contra MIME-sniffing e clickjacking |

### Verificações Executadas

- [x] Testes automatizados da Etapa 5 executados (12/12 aprovados em `testes/etapa5.test.js`)
- [x] Regressão total do projeto (Etapas 1 a 5) re-executada: **201/201 testes aprovados (100% de sucesso)**

### Arquivos Criados / Alterados (Etapa 5)

| Arquivo | Ação | Descrição |
|---------|------|-----------|
| `src/utils/cors.js` | Criado | Configuração de CORS com whitelist e suporte a mobile/ferramentas |
| `src/middlewares/security.js` | Criado | Limitadores `loginLimiter`, `registerLimiter` e middleware `securityHeaders` |
| `src/routes/user.js` | Alterado | Limitadores aplicados nas rotas de login e cadastro |
| `src/server.js` | Alterado | `securityHeaders` e CORS configurados no pipeline Express |
| `.env.example` | Alterado | Adicionadas variáveis `CORS_ORIGIN`, `NODE_ENV`, `PORT` |
| `testes/etapa5.test.js` | Criado | Bateria de testes de infraestrutura e produção |

---

### Conclusão da Etapa 2: Centralização de Endereço e Padronização de Favoritos

#### 1. Fonte de Referência do Endereço Comercial
- **Autoridade Estruturada:** A tabela `Address` é a fonte oficial dos dados físicos e estruturados do endereço (`place`, `number`, `zipcode`, `lat`, `long`, `street`, `neighborhood`, `city`, `state`, `complement`).
- **Projeção em Company:** A tabela `Company` mantém os campos de endereço (`places`, `street`, `number`, `neighborhood`, `city`, `state`, `complement`, `zipcode`) como uma projeção direta necessária à compatibilidade imediata com telas do frontend e pesquisas globais.
- **Sincronização Atômica:** Ambas as representações são atualizadas sempre dentro de uma mesma transação do Prisma (`prisma.$transaction`), garantindo que se uma gravação falhar, a outra seja revertida (rollback) e nunca ocorra divergência de dados.

#### 2. Tratamento de Campos Omitidos, Vazios e Nulos
- **Campos Omitidos (`undefined`):** Preservam integralmente os valores já existentes no banco de dados. Nunca são interpretados como remoção ou sobrescritos com nulos.
- **Campos Nulos (`null`):**
  - Em **campos opcionais** (`street`, `neighborhood`, `city`, `state`, `complement`): representam remoção explícita do valor, gravando `null` de forma sincronizada em `Company` e `Address`.
  - Em **campos obrigatórios** (`places` em Company; `place`, `number` e `zipcode` em Address): a tentativa de atribuir `null` é rejeitada imediatamente antes da persistência com `HTTP 400 Bad Request`.
  - Em empresas sem `Address` vinculado: `number` e `zipcode` são opcionais no schema de `Company`, portanto `null` é aceito para limpeza.
- **Strings Vazias (`""`) ou com apenas espaços:**
  - Em campos obrigatórios (`places`, `place`, e `number`/`zipcode` quando vinculado): rejeitadas com `HTTP 400 Bad Request`.
  - Em campos opcionais: interpretadas como intenção de remoção (`null`).
- **Diferenciação Estrita:** O sistema não utiliza testes de verdade (`!val` ou `val ?`) para diferenciar campo omitido de campo explicitamente removido, checando expressamente a presença da chave e tipos primitivos.

#### 3. Preservação de Registros Legados
- **Empresa com `places` preenchido e campos estruturados nulos, mas com `Address` vinculado:**
  - Ao editar apenas um campo (ex: `city: "Campinas"`), o backend consulta o `Address` vinculado antes de qualquer merge.
  - Os campos omitidos (`street`, `number`, `neighborhood`, `zipcode`, `state`) são preenchidos a partir do `Address`, e o novo `places` é recomposto sem perder a rua, o número ou o CEP.
- **Empresa apenas com texto livre legado em `places` (sem componentes estruturados suficientes):**
  - O backend não tenta decompor o texto por divisão de vírgulas (o que geraria dados incorretos).
  - A alteração de campos parciais (ex: apenas `city` ou `state`) atualiza a coluna correspondente mas **preserva o texto legado em `places`**, evitando que o endereço seja destruído e substituído apenas pelo nome da cidade. O texto só é recomposto quando houver dados estruturados completos (ao menos logradouro e número/bairro) ou quando o cliente enviar explicitamente um novo `places`.

#### 4. Precedência e Não Duplicação
- **Não Duplicação de Número:** A função `formatStreetWithNumber` verifica se o logradouro já inclui o número ao final (ex: `"Rua das Flores, 100"` com `number: "100"`), impedindo a formação de endereços como `"Rua das Flores, 100, 100"`.
- **Precedência Consistente:** Campos estruturados fornecidos têm precedência composicional sobre o texto livre para compor `places`/`place`, assegurando que não existam contradições entre colunas estruturadas e a descrição textual. Se o cliente enviar apenas texto livre, este é validado e aplicado diretamente.

#### 5. Múltiplos Vínculos e Limitações do Modelo Atual
- **Edição via Company (`PUT /company/:id`):** Se a empresa possuir mais de 1 endereço comercial vinculado, é obrigatório enviar `addressId`. O backend valida estritamente se o `addressId` pertence àquela empresa (inclusive em empresas com vínculo único se o cliente enviar o identificador), rejeitando com `400 Bad Request` caso não pertença.
- **Edição direta via Address (`PUT /address/:id`):** Se a empresa vinculada possuir múltiplos endereços cadastrados, o backend retorna `HTTP 409 Conflict`.
  - *Limitação Documentada:* O modelo de dados atual (`AddressCompany`) não possui flags como `isPrimary` ou `mainAddressId` para definir qual dos múltiplos endereços é a projeção refletida na tabela `Company`. Para evitar sobreposições ambíguas e destruição silenciosa da projeção, a edição desse endereço deve ser feita através da rota da empresa com o `addressId` específico.
- **Autorização Cruzada:** Antes de salvar qualquer sincronização, o backend valida se o usuário autenticado tem permissão sobre todos os registros envolvidos. É bloqueada com `HTTP 403 Forbidden` qualquer tentativa de alterar indiretamente empresas pertencentes a outros proprietários.

#### 6. Detecção de Conflitos Pré-existentes
- Se `Company` e `Address` já possuem valores divergentes em um campo estruturado (ex: Company com cidade "Curitiba" e Address com cidade "Florianópolis"), e o cliente enviar uma edição omitindo esse campo, o sistema **não escolhe silenciosamente um lado**: retorna `HTTP 409 Conflict` orientando o cliente a enviar explicitamente o campo em questão para sanar a divergência.

#### 7. Padronização de Favoritos
- Em `listUserFavorites` (`GET /company/favorites`), a empresa associada a cada favorito passa pelo formatador canônico `formatCompanyResponse(favorite.company)`.
- A estrutura externa `{ id, userId, companyId, createdAt, updatedAt, company }` é preservada.
- O objeto interno `company` agora disponibiliza:
  - `amenities` como array de strings e `amenitiesMap` como mapa de booleanos;
  - `subcategories` como array de strings;
  - Espelhos retrocompatíveis: `logoUrl`, `coverUrl`, `capa`, `site`, `whatsApp`, `telefone`.

---

### Exemplos de Requisição e Resposta

#### Exemplo 1: Edição Parcial de Empresa com Preservação de Campos do Address
**Requisição:**
```http
PUT /company/10
Authorization: Bearer <TOKEN_OWNER>
Content-Type: application/json

{
  "city": "Campinas"
}
```

**Resposta (`202 Accepted`):**
```json
{
  "id": 10,
  "name": "Padaria Central",
  "category": "Padaria",
  "places": "Rua das Flores, 100, Bela Vista, Campinas - SP",
  "street": "Rua das Flores",
  "number": "100",
  "neighborhood": "Bela Vista",
  "city": "Campinas",
  "state": "SP",
  "zipcode": "01310-000",
  "logoUrl": "https://i.ibb.co/logo.png",
  "amenities": ["Wi-Fi"],
  "amenitiesMap": { "Wi-Fi": true }
}
```

#### Exemplo 2: Conflito Pré-existente entre Company e Address
**Requisição:**
```http
PUT /company/10
Authorization: Bearer <TOKEN_OWNER>
Content-Type: application/json

{
  "number": "102"
}
```

**Resposta (`409 Conflict`):**
```json
{
  "error": "Conflito de dados de endereço entre a empresa e o endereço vinculado no campo 'city' ('Curitiba' vs 'Florianópolis'). Envie explicitamente o campo 'city' na requisição para resolver a divergência."
}
```

#### Exemplo 3: Consulta de Favoritos Padronizada
**Requisição:**
```http
GET /company/favorites
Authorization: Bearer <TOKEN_USER>
```

**Resposta (`200 OK`):**
```json
[
  {
    "id": 1,
    "userId": 5,
    "companyId": 10,
    "createdAt": "2026-09-27T20:00:00.000Z",
    "updatedAt": "2026-09-27T20:00:00.000Z",
    "company": {
      "id": 10,
      "name": "Padaria Central",
      "category": "Padaria",
      "places": "Rua das Flores, 100, Bela Vista, Campinas - SP",
      "logoUrl": "https://i.ibb.co/logo.png",
      "coverUrl": "https://i.ibb.co/cover.png",
      "capa": "https://i.ibb.co/cover.png",
      "site": "https://padariacentral.com",
      "whatsApp": "+5511999998888",
      "telefone": "+551133334444",
      "amenities": ["Wi-Fi", "Pet Friendly"],
      "amenitiesMap": { "Wi-Fi": true, "Pet Friendly": true },
      "subcategories": ["Pães Artesanais", "Cafés"]
    }
  }
]
```

---

### Impactos no Frontend

1. **Validação Rígida em Remoção de Endereço:** Formulários do painel de administração não devem enviar strings vazias `""` ou `null` para `places` ou para `number`/`zipcode` de empresas com endereço cadastrado, pois o backend rejeita com erro `400`.
2. **Tratamento de Erro `409 Conflict`:** Telas de edição de empresa devem tratar o status `409` exibindo a mensagem orientadora caso registros históricos possuam divergência cadastral entre a sede e a ficha do endereço.
3. **Consumo de Favoritos Padronizado:** O frontend não precisa mais de tratamentos condicionais para extrair comodidades e imagens em favoritos; a estrutura do objeto `company` dentro de cada favorito agora possui a mesma tipagem canônica e os mesmos espelhos retrocompatíveis (`logoUrl`, `site`, `whatsApp`, `amenities`, etc.) que `GET /company` e `GET /company/:id`.
4. **Status de Validação com o Frontend:** *Pendente de teste em UI* (o workspace da aplicação frontend React/Vite encontra-se fora do repositório backend, sendo necessária validação nas telas integradas pela equipe de interface).

---

## Status Geral e Suítes de Testes

Todas as suítes de teste operam com banco temporário isolado (`testes/helpers/testDb.js`), garantindo que nenhum `deleteMany` ou operação de teste afete o banco de desenvolvimento (`prisma/dev.db`).

| Suíte de Teste | Arquivo | Cobertura | Status |
|----------------|---------|-----------|--------|
| **Migração sobre Dados Legados** | `testes/migration_dados_antigos.test.js` | Execução real de migrações (deploy) e preservação estrita de dados legados | 39/39 Aprovados |
| **Regressão de Segurança** | `testes/regressao_seguranca.test.js` | Não exposição de users em Address, posse prévia antes de upload, integridade em Company | 22/22 Aprovados |
| **Consistência de Endereço & Favoritos** | `testes/etapa2_consistencia_endereco.test.js` | Centralização de endereços, preservação legada, rollback atômico, favoritos normalizados | 72/72 Aprovados |
| **Etapa 1** | `testes/etapa1.test.js` | Autenticação, sanitização de senhas, autorização de pagamentos | 67/67 Aprovados |
| **Etapa 2** | `testes/etapa2.test.js` | Endereços, uploads via Sharp, perfil de Company, filtros de privacidade | 147/147 Aprovados |
| **Etapa 3** | `testes/etapa3.test.js` | Contratos de Company, integridade referencial, bloqueio de exclusão com pagamentos | 39/39 Aprovados |
| **Etapa 4** | `testes/etapa4.test.js` | Validações cronológicas de pagamento, queries e unicidade de favoritos | 29/29 Aprovados |
| **Etapa 5** | `testes/etapa5.test.js` | Headers defensivos, CORS com whitelist, Rate Limiting | 12/12 Aprovados |
| **TOTAL** | — | **Cobertura completa de consistência, integridade, migrações e segurança** | **427/427 Aprovados (100%)** |

### Nota sobre isolamento de testes e montagem de rotas
- A montagem de rotas foi unificada em `src/app.js`, consumida tanto por `src/server.js` quanto pelas baterias de teste, assegurando paridade idêntica de middlewares, parsers e autenticação.
- O helper `testes/helpers/testDb.js` gera um arquivo SQLite exclusivo por execução (`temp_test_<pid>_<timestamp>.db`), aplica o schema via Prisma e remove os arquivos (`.db`, `.db-wal`, `.db-shm`) ao término.

### Nota sobre criação de administradores
A criação de contas admin foi bloqueada no cadastro público. Administradores devem ser criados por procedimento restrito (ex: seed script ou painel administrativo).

### Nota sobre integração com frontend
O frontend (React/Vite) está em workspace separado. As mudanças preservam estritamente os formatos de resposta consumidos (`message`, `token`, `user`), eliminando o vazamento de hashes e dados não públicos, e entregando contratos consistentes e normalizados.

