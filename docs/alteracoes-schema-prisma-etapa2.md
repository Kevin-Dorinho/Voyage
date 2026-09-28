# Documentação de Alterações no Prisma Schema — Etapa 2
**Projeto:** Voyage — Backend & Frontend Integration  
**Data:** 27 de Setembro de 2026  
**Responsável:** Equipe de Backend Voyage  
**Arquivo principal:** `prisma/schema.prisma`  
**Migração associada:** `20260927221000_company_and_address_expanded_fields`

---

## 1. Visão Geral

Na modelagem inicial do banco de dados, as tabelas `Company` e `Address` atendiam apenas a um protótipo básico (nome, CNPJ, categoria genérica e um campo textual simples de endereço chamado `places`).

Com a evolução das telas do **Painel do Lojista (Dashboard)** e da **Página de Perfil do Estabelecimento no Frontend**, surgiu a necessidade de:
1. **Estruturar os endereços por campos individuais** (rua, número, bairro, cidade, estado, CEP, complemento) para permitir autocomplete (ex: ViaCEP), filtros geográficos refinados e preenchimento organizado de formulários.
2. **Expandir o perfil da empresa com contatos e redes sociais** (WhatsApp comercial, Instagram, site oficial, telefone fixo, e-mail).
3. **Suportar identidade visual rica** (logotipo quadrado/circular e banner largo de capa).
4. **Permitir filtros avançados e tags** (comodidades do local como Wi-Fi, Ar-condicionado, Pet Friendly, e subcategorias de nicho).

Todas essas colunas foram adicionadas com migrações não-destrutivas (`ALTER TABLE ... ADD COLUMN`), garantindo que **nenhum dado existente fosse apagado ou corrompido**.

---

## 2. O que mudou no código do `prisma/schema.prisma`

### 2.1 Modelo `Address`

```prisma
model Address {
  id            Int       @id @default(autoincrement())

  // Campos existentes
  place         String
  number        String

  // 🌟 NOVOS CAMPOS ESTRUTURADOS:
  street        String?   // Nome da rua / logradouro
  neighborhood  String?   // Bairro
  city          String?   // Cidade
  state         String?   // Estado (UF)
  complement    String?   // Complemento (bloco, sala, apto)

  // Relações e localização geográfica
  users         User[]    @relation("addressUser")
  addressCompany AddressCompany[]

  zipcode       String
  lat           Float
  long          Float
  url           String

  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  @@map("address")
}
```

---

### 2.2 Modelo `Company`

```prisma
model Company {
  id            Int       @id @default(autoincrement())
  name          String
  category      String
  cnpj          String    @unique
  evaluate      Float     @default(0.0)
  places        String
  userId        Int       @map("user_id")

  // 🌟 NOVOS CAMPOS DE APRESENTAÇÃO E CONTATO:
  description   String?   // Sobre a empresa / bio institucional
  phone         String?   // Telefone comercial
  email         String?   // E-mail de atendimento
  openingHours  String?   @map("opening_hours") // Horário descritivo (ex: "Seg-Sex: 08h às 18h")
  logo          String?   // URL do logotipo da empresa
  cover         String?   // URL do banner de capa
  whatsapp      String?   // WhatsApp com link direto
  instagram     String?   // Link / perfil do Instagram
  website       String?   // Site oficial da empresa

  // 🌟 NOVOS CAMPOS DE FILTROS E TAGS:
  amenities     String?   // JSON com comodidades (ex: ["Wi-Fi", "Pet Friendly"])
  subcategories String?   // JSON com nichos (ex: ["Massas", "Vinhos"])

  // 🌟 ENDEREÇO ESTRUTURADO NO PRÓPRIO REGISTRO DA EMPRESA:
  street        String?   // Logradouro / Rua
  number        String?   // Número
  neighborhood  String?   // Bairro
  city          String?   // Cidade
  state         String?   // Estado (UF)
  complement    String?   // Complemento
  zipcode       String?   // CEP

  // Relações
  user          User      @relation(fields: [userId], references: [id])
  payment       Payment[]
  favorite      Favorite[]
  addressCompany AddressCompany[]

  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  @@map("companies")
}
```

---

## 3. Detalhamento dos Campos e Funcionalidades para o Frontend

### 3.1 Tabela `Address`

| Campo | Tipo | Significado | Como o Frontend usa |
| :--- | :---: | :--- | :--- |
| **`street`** | `String?` | Nome da rua/avenida. | Preenche o campo "Logradouro" nos formulários de cadastro sem misturar com o número. Integra diretamente com APIs como ViaCEP. |
| **`neighborhood`** | `String?` | Bairro onde o local fica. | Permite que o frontend crie filtros por bairro na listagem (ex: "Buscar restaurantes no Centro"). |
| **`city`** | `String?` | Município. | Permite busca e segmentação por cidade ou região metropolitana. |
| **`state`** | `String?` | Estado / UF (ex: `SP`). | Alimenta dropdowns de seleção de UF e padroniza a exibição regional. |
| **`complement`** | `String?` | Detalhes adicionais (sala, bloco, andar, apto). | Essencial para que entregadores e clientes encontrem o estabelecimento em prédios comerciais ou galerias. |

---

### 3.2 Tabela `Company`

#### A. Contatos e Redes Sociais
| Campo | Tipo | Significado | Como o Frontend usa |
| :--- | :---: | :--- | :--- |
| **`whatsapp`** | `String?` | Número de WhatsApp comercial. | Renderiza o botão verde oficial **"Falar no WhatsApp"**, gerando o link direto `https://wa.me/5511...` com um clique. |
| **`instagram`** | `String?` | Usuário ou link do Instagram. | Exibe o ícone social do Instagram, levando o usuário para a página de fotos e novidades da loja. |
| **`website`** | `String?` | Link do site oficial da loja. | Exibe o botão "Acessar site institucional". |
| **`phone`** | `String?` | Telefone fixo da loja. | Permite disparar chamada direta em celulares com `tel:...`. |
| **`email`** | `String?` | E-mail de suporte/contato. | Botão de "Enviar e-mail" via `mailto:...`. |

#### B. Identidade Visual e Apresentação
| Campo | Tipo | Significado | Como o Frontend usa |
| :--- | :---: | :--- | :--- |
| **`logo`** | `String?` | URL da foto do logotipo. | Mostra o avatar da marca nos cards de busca e no topo da página. |
| **`cover`** | `String?` | URL do banner de capa (foto panorâmica). | Renderiza o banner de fundo da página de perfil do estabelecimento, dando aspecto premium à interface. |
| **`description`** | `String?` | Texto institucional ("Sobre nós"). | Exibe a bio/história do estabelecimento para atrair novos clientes. |
| **`openingHours`** | `String?` | Horário de atendimento textual. | Exibe no card de informações quando o local está aberto (ex: *"Seg a Sex das 07h às 19h; Sáb das 08h às 14h"*). |

#### C. Tags, Filtros e Nichos
| Campo | Tipo | Significado | Como o Frontend usa |
| :--- | :---: | :--- | :--- |
| **`amenities`** | `String?` | Array serializado de comodidades do local. | O frontend recebe um array (ex: `["Wi-Fi Grátis", "Ar Condicionado", "Pet Friendly"]`) e renderiza badges coloridos com ícones. Permite criar filtros rápidos para os usuários. |
| **`subcategories`** | `String?` | Subcategorias específicas dentro da categoria mãe. | Se a categoria for *Restaurante*, as subcategorias podem ser `["Massas", "Vinhos", "Carnes"]`. Permite buscas mais ricas no app. |

#### D. Endereço Estruturado no próprio perfil da Empresa
| Campos | Tipo | Significado | Como o Frontend usa |
| :--- | :---: | :--- | :--- |
| **`street`**, **`number`**, **`neighborhood`**, **`city`**, **`state`**, **`complement`**, **`zipcode`** | `String?` | Espelho do endereço estruturado. | Permite que o formulário de "Editar Perfil da Minha Empresa" no painel do lojista salve nome, contatos e endereço completo em **uma única requisição**, simplificando a vida do frontend. |

---

## 4. Adaptador Inteligente de Nomes (Frontend ⟷ Backend)

Para evitar que o frontend precise reescrever o nome de propriedades em formulários legados ou já desenhados, o backend implementou um **adaptador de contratos bidirecional**:

### Aliases aceitos na criação/edição:
- `logoUrl` ➔ preenche `logo`
- `capa` ou `coverUrl` ➔ preenche `cover`
- `site` ou `siteUrl` ➔ preenche `website`
- `whatsApp` ➔ preenche `whatsapp`
- `insta` ou `instagramUrl` ➔ preenche `instagram`
- `rua`, `numero`, `bairro`, `cidade`, `uf`, `cep`, `complemento` ➔ preenchem os respectivos campos em inglês
- `comodidades` (array JS ou objeto de booleanos) ➔ valida e persiste em `amenities` como JSON estável
- `subcategorias` (array JS) ➔ persiste em `subcategories`

### Resposta do Backend:
Ao consultar `GET /company/:id`, o backend retorna **tanto o nome canônico quanto o espelho**:
```json
{
  "id": 1,
  "name": "Boutique & Café Gourmet",
  "category": "Café",
  "description": "Cafés especiais premiados",
  "logo": "https://meubucket.com/logo.png",
  "logoUrl": "https://meubucket.com/logo.png",
  "cover": "https://meubucket.com/banner.jpg",
  "coverUrl": "https://meubucket.com/banner.jpg",
  "website": "https://cafegourmet.com.br",
  "site": "https://cafegourmet.com.br",
  "whatsapp": "(11) 98765-4321",
  "whatsApp": "(11) 98765-4321",
  "instagram": "@cafegourmetsp",
  "amenities": ["Wi-Fi Grátis", "Ar Condicionado", "Estacionamento"],
  "amenitiesMap": {
    "Wi-Fi Grátis": true,
    "Ar Condicionado": true,
    "Estacionamento": true
  },
  "subcategories": ["Cafés Filtrados", "Espressos"],
  "street": "Alameda dos Anjos",
  "city": "São Paulo",
  "state": "SP"
}
```
*Dessa forma, qualquer componente do frontend (usando `logoUrl` ou `logo`, `site` ou `website`, `amenities` como array ou objeto) funciona perfeitamente sem erros de `undefined` ou `[object Object]`.*

---

## 5. Regras de Negócio e Robustez Implementadas no Backend

1. **Validação Zod Compartilhada e Estrita**:
   - Criação e edição compartilham as mesmas regras rígidas de validação de campos, limites e formatos.
   - Na edição, campos omitidos são preservados, mas valores inválidos (nome vazio, categorias inexistentes, descrições acima de 500 caracteres, números ou objetos passados para campos texto) são rejeitados com `400 Bad Request` sem conversão implícita.
2. **Atualização Parcial de Endereço Inteligente**:
   - Alterar somente a cidade combina o novo dado com o logradouro e número já existentes no banco, atualizando o campo `places` sem apagar rua e número.
   - Trata remoção explícita de campos estruturados (`null`).
3. **Fonte Principal de Endereço e Sincronização em Transação**:
   - `Address` é a autoridade central dos dados geoespaciais e físicos.
   - Atualizações em `Company` sincronizam atomicamente o registro relacionado em `Address` via `prisma.$transaction`.
   - Se a empresa possuir múltiplos endereços comerciais vinculados, o backend exige o envio de `addressId`, impedindo escolhas arbitrárias silenciosas.
4. **Comodidades Tipadas (Objetos de Booleanos e Arrays)**:
   - Aceita o formato comum do frontend `{ "Wi-Fi Grátis": true, "Pet Friendly": false }`.
   - Extrai apenas os itens ativos, valida a tipagem booleana estrita e grava JSON padronizado, impedindo a gravação de `"[object Object]"` no banco.
5. **Decodificação Real de Pixels via `Sharp`**:
   - Substituída a inspeção manual por decodificação real de pixels com `Sharp`.
   - Identifica arquivos truncados, imagens sem dados de pixels (ex: PNG sem chunk `IDAT`) e rejeita arquivos corrompidos com `400 Bad Request` antes do envio ao provedor de upload.
6. **Bloqueio de `evaluate`**: Usuários comuns não podem alterar sua própria nota via `POST /company` ou `PUT /company/:id`. O valor inicial é sempre gerenciado pelo sistema (`0.0`), e apenas administradores podem moderar a nota.

---

## 6. Como apresentar isso para o seu grupo

> **Resumo em 3 pontos principais:**
> 1. **Para os Lojistas:** Eles agora conseguem cadastrar e editar WhatsApp, Instagram, site oficial, banner de capa, logo, horário de funcionamento e endereço completo em um único formulário integrado.
> 2. **Para os Usuários do App:** Podem filtrar lojas por comodidades (ex: "Tem Wi-Fi?", "É Pet Friendly?") e por nichos específicos (subcategorias), com contato direto via WhatsApp em um clique.
> 3. **Para a Equipe de Frontend:** O backend é tolerante e compatível (aceita tanto nomes em português quanto em inglês, aceita comodidades como array ou objeto de booleanos e sincroniza os endereços automaticamente sem divergências).

