import prisma from '../utils/prisma.js';
import { z } from 'zod';
import { attachSave } from "../utils/save.js";
import {
    prepareCompanyAddressUpdate,
    composePlaceString,
    AddressConsistencyError,
    getTestTransactionHook
} from "../utils/addressConsistency.js";

function isValidCNPJ(cnpj) {
    if (!cnpj || typeof cnpj !== 'string') return false;
    cnpj = cnpj.replace(/[^\d]+/g, '');
    if (cnpj.length !== 14) return false;
    if (/^(\d)\1+$/.test(cnpj)) return false;

    let size = cnpj.length - 2;
    let numbers = cnpj.substring(0, size);
    let digits = cnpj.substring(size);
    let sum = 0;
    let pos = size - 7;
    for (let i = size; i >= 1; i--) {
        sum += numbers.charAt(size - i) * pos--;
        if (pos < 2) pos = 9;
    }
    let result = sum % 11 < 2 ? 0 : 11 - sum % 11;
    if (result != digits.charAt(0)) return false;

    size = size + 1;
    numbers = cnpj.substring(0, size);
    sum = 0;
    pos = size - 7;
    for (let i = size; i >= 1; i--) {
        sum += numbers.charAt(size - i) * pos--;
        if (pos < 2) pos = 9;
    }
    result = sum % 11 < 2 ? 0 : 11 - sum % 11;
    if (result != digits.charAt(1)) return false;

    return true;
}

export const VALID_CATEGORIES = [
    "Lanchonete", "Restaurante", "Pizzaria", "Churrascaria",
    "Supermercado", "Farmácia", "Serviços", "Hospital", "Outros", "Bar",
    "Padaria", "Café", "Sorveteria"
];

const categoryMap = {
    "farmacia": "Farmácia",
    "farmácia": "Farmácia",
    "servicos": "Serviços",
    "serviços": "Serviços",
    "cafe": "Café",
    "café": "Café",
    "outro": "Outros",
    "outros": "Outros"
};

export function normalizeCategory(cat) {
    if (!cat || typeof cat !== "string") return cat;
    const lower = cat.trim().toLowerCase();
    if (categoryMap[lower]) return categoryMap[lower];
    const match = VALID_CATEGORIES.find(c => c.toLowerCase() === lower);
    return match || cat.trim();
}

/**
 * Valida e converte comodidades (amenities) para JSON serializado estável.
 * Suporta:
 * - Array de strings: ["Wi-Fi", "Ar Condicionado"]
 * - Objeto de booleanos (formato do frontend): { wifi: true, arCondicionado: true, petFriendly: false }
 * - String JSON já serializada ou lista separada por vírgula
 * Rejeita formatos inválidos sem converter objetos arbitrários em "[object Object]".
 */
export function parseAndValidateAmenities(input) {
    if (input === undefined) return undefined;
    if (input === null || input === "") return null;

    let val = input;
    if (typeof input === "string") {
        const trimmed = input.trim();
        if (trimmed === "" || trimmed === "null") return null;
        if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
            try {
                val = JSON.parse(trimmed);
            } catch (_) {
                throw new Error("Formato JSON inválido para comodidades.");
            }
        } else {
            val = trimmed.split(",").map(s => s.trim()).filter(Boolean);
        }
    }

    if (Array.isArray(val)) {
        if (val.length === 0) return JSON.stringify([]);
        for (const item of val) {
            if (typeof item !== "string" || item.trim() === "") {
                throw new Error("Itens da lista de comodidades devem ser strings não-vazias.");
            }
        }
        return JSON.stringify(val.map(s => s.trim()));
    }

    if (typeof val === "object" && val !== null) {
        const result = [];
        for (const [key, enabled] of Object.entries(val)) {
            if (typeof enabled !== "boolean") {
                throw new Error(`O valor da comodidade '${key}' deve ser booleano (true ou false).`);
            }
            if (enabled === true) {
                result.push(key.trim());
            }
        }
        return JSON.stringify(result);
    }

    throw new Error("Formato inválido para comodidades. Envie um array de strings ou um objeto com valores booleanos.");
}

/**
 * Valida e converte subcategorias para JSON serializado estável.
 * Suporta:
 * - Array de strings: ["Cafés Filtrados", "Espressos"]
 * - String JSON ou delimitada por vírgulas
 */
export function parseAndValidateSubcategories(input) {
    if (input === undefined) return undefined;
    if (input === null || input === "") return null;

    let val = input;
    if (typeof input === "string") {
        const trimmed = input.trim();
        if (trimmed === "" || trimmed === "null") return null;
        if (trimmed.startsWith("[")) {
            try {
                val = JSON.parse(trimmed);
            } catch (_) {
                throw new Error("Formato JSON inválido para subcategorias.");
            }
        } else {
            val = trimmed.split(",").map(s => s.trim()).filter(Boolean);
        }
    }

    if (Array.isArray(val)) {
        if (val.length === 0) return JSON.stringify([]);
        for (const item of val) {
            if (typeof item !== "string" || item.trim() === "") {
                throw new Error("Itens da lista de subcategorias devem ser strings não-vazias.");
            }
        }
        return JSON.stringify(val.map(s => s.trim()));
    }

    throw new Error("Formato inválido para subcategorias. Envie um array de strings.");
}

export function adaptInboundCompanyData(raw) {
    if (!raw || typeof raw !== "object") return raw;
    const body = { ...raw };

    // Adaptadores de Imagens (logo e capa)
    if (body.logoUrl !== undefined && body.logo === undefined) body.logo = body.logoUrl;
    if (body.logo_url !== undefined && body.logo === undefined) body.logo = body.logo_url;
    if (body.coverUrl !== undefined && body.cover === undefined) body.cover = body.coverUrl;
    if (body.cover_url !== undefined && body.cover === undefined) body.cover = body.cover_url;
    if (body.capa !== undefined && body.cover === undefined) body.cover = body.capa;

    // Adaptadores de Contato
    if (body.site !== undefined && body.website === undefined) body.website = body.site;
    if (body.siteUrl !== undefined && body.website === undefined) body.website = body.siteUrl;
    if (body.whatsApp !== undefined && body.whatsapp === undefined) body.whatsapp = body.whatsApp;
    if (body.telefone !== undefined && body.phone === undefined) body.phone = body.telefone;
    if (body.insta !== undefined && body.instagram === undefined) body.instagram = body.insta;
    if (body.instagramUrl !== undefined && body.instagram === undefined) body.instagram = body.instagramUrl;

    // Adaptadores de listas (comodidades e subcategorias)
    if (body.comodidades !== undefined && body.amenities === undefined) body.amenities = body.comodidades;
    if (body.subcategorias !== undefined && body.subcategories === undefined) body.subcategories = body.subcategorias;

    // Adaptadores de Endereço estruturado
    if (body.rua !== undefined && body.street === undefined) body.street = body.rua;
    if (body.logradouro !== undefined && body.street === undefined) body.street = body.logradouro;
    if (body.numero !== undefined && body.number === undefined) body.number = body.numero;
    if (body.bairro !== undefined && body.neighborhood === undefined) body.neighborhood = body.bairro;
    if (body.cidade !== undefined && body.city === undefined) body.city = body.cidade;
    if (body.estado !== undefined && body.state === undefined) body.state = body.estado;
    if (body.uf !== undefined && body.state === undefined) body.state = body.uf;
    if (body.cep !== undefined && body.zipcode === undefined) body.zipcode = body.cep;
    if (body.complemento !== undefined && body.complement === undefined) body.complement = body.complemento;

    return body;
}

export function formatCompanyResponse(c) {
    if (!c || typeof c !== "object") return c;

    let amenitiesParsed = null;
    let amenitiesMap = {};
    if (c.amenities) {
        if (typeof c.amenities === "string") {
            try {
                const parsed = JSON.parse(c.amenities);
                if (Array.isArray(parsed)) {
                    amenitiesParsed = parsed;
                    parsed.forEach(item => { amenitiesMap[item] = true; });
                } else if (typeof parsed === "object" && parsed !== null) {
                    amenitiesParsed = Object.keys(parsed).filter(k => parsed[k] === true);
                    amenitiesMap = parsed;
                }
            } catch (_) {
                amenitiesParsed = [c.amenities];
                amenitiesMap[c.amenities] = true;
            }
        } else if (Array.isArray(c.amenities)) {
            amenitiesParsed = c.amenities;
            c.amenities.forEach(item => { amenitiesMap[item] = true; });
        }
    }

    let subcategoriesParsed = null;
    if (c.subcategories) {
        if (typeof c.subcategories === "string") {
            try {
                const parsed = JSON.parse(c.subcategories);
                if (Array.isArray(parsed)) subcategoriesParsed = parsed;
            } catch (_) {
                subcategoriesParsed = [c.subcategories];
            }
        } else if (Array.isArray(c.subcategories)) {
            subcategoriesParsed = c.subcategories;
        }
    }

    return {
        ...c,
        logoUrl: c.logo || null,
        coverUrl: c.cover || null,
        capa: c.cover || null,
        site: c.website || null,
        whatsApp: c.whatsapp || null,
        telefone: c.phone || null,
        amenities: amenitiesParsed,
        amenitiesMap: Object.keys(amenitiesMap).length > 0 ? amenitiesMap : null,
        subcategories: subcategoriesParsed
    };
}

// =========================================================================
// ESQUEMAS ZOD COMPARTILHADOS (CRIAÇÃO E EDIÇÃO)
// =========================================================================

const nameValidator = z.string({
    required_error: "Nome é obrigatório",
    invalid_type_error: "Nome deve ser uma string"
})
    .trim()
    .min(3, "Nome muito curto (possível nome fictício)")
    .max(100, "Nome muito longo (máximo 100 caracteres)");

const categoryValidator = z.preprocess(
    (val) => (typeof val === "string" ? normalizeCategory(val) : val),
    z.enum(VALID_CATEGORIES, {
        errorMap: () => ({ message: "A categoria não existe / é inválida. Use uma categoria válida." })
    })
);

const cnpjValidator = z.string({
    required_error: "CNPJ é obrigatório",
    invalid_type_error: "CNPJ deve ser uma string"
})
    .trim()
    .regex(/^\d{2}\.\d{3}\.\d{3}\/\d{4}\-\d{2}$|^\d{14}$/, "CNPJ inválido. Verifique a formatação do campo.")
    .refine((val) => isValidCNPJ(val), { message: "CNPJ inválido (não passou na verificação de dígitos matemáticos)." });

const placesValidator = z.string({
    required_error: "Endereço é obrigatório",
    invalid_type_error: "Endereço deve ser uma string"
})
    .trim()
    .min(3, "Endereço incorreto / muito curto forneça detalhes do local")
    .max(300, "Endereço muito longo (máximo 300 caracteres)");

const descriptionValidator = z.string({ invalid_type_error: "Descrição deve ser uma string" })
    .max(500, "Descrição muito longa (máximo 500 caracteres)");

const phoneValidator = z.string({ invalid_type_error: "Telefone deve ser uma string" })
    .trim()
    .regex(/^\+?[0-9\s()+-]{8,25}$/, "Telefone com formato inválido");

const emailValidator = z.string({ invalid_type_error: "E-mail deve ser uma string" })
    .trim()
    .email("E-mail com formato inválido")
    .max(100, "E-mail muito longo");

const openingHoursValidator = z.string({ invalid_type_error: "Horário de funcionamento deve ser uma string" })
    .max(150, "Horário de funcionamento muito longo (máximo 150 caracteres)");

const logoValidator = z.string({ invalid_type_error: "Logo deve ser uma string" })
    .max(500, "Logo muito longo");

const coverValidator = z.string({ invalid_type_error: "Capa deve ser uma string" })
    .max(500, "Capa muito longa");

const whatsappValidator = z.string({ invalid_type_error: "WhatsApp deve ser uma string" })
    .trim()
    .regex(/^\+?[0-9\s()+-]{8,25}$/, "WhatsApp com formato inválido");

const instagramValidator = z.string({ invalid_type_error: "Instagram deve ser uma string" })
    .max(100, "Instagram muito longo");

const websiteValidator = z.string({ invalid_type_error: "Website deve ser uma string" })
    .max(255, "Website muito longo");

const streetValidator = z.string({ invalid_type_error: "Rua deve ser uma string" })
    .max(150, "Rua muito longa");

const neighborhoodValidator = z.string({ invalid_type_error: "Bairro deve ser uma string" })
    .max(100, "Bairro muito longo");

const cityValidator = z.string({ invalid_type_error: "Cidade deve ser uma string" })
    .max(100, "Cidade muito longa");

const stateValidator = z.string({ invalid_type_error: "Estado deve ser uma string" })
    .max(50, "Estado muito longo");

const complementValidator = z.string({ invalid_type_error: "Complemento deve ser uma string" })
    .max(100, "Complemento muito longo");

const zipcodeValidator = z.string({ invalid_type_error: "CEP deve ser uma string" })
    .max(20, "CEP muito longo");

const numberValidator = z.string({ invalid_type_error: "Número deve ser uma string" })
    .max(20, "Número muito longo");

// Trata campos opcionais na criação/edição: string vazia vira null; null vira null
function nullableOptionalString(validator) {
    return z.preprocess((val) => {
        if (val === "" || val === null) return null;
        return val;
    }, validator.nullable().optional());
}

// 1. Esquema de Criação (Campos obrigatórios exigidos)
const createCompanySchema = z.object({
    name: nameValidator,
    category: categoryValidator,
    cnpj: cnpjValidator,
    places: placesValidator.optional(),
    description: nullableOptionalString(descriptionValidator),
    phone: nullableOptionalString(phoneValidator),
    email: nullableOptionalString(emailValidator),
    openingHours: nullableOptionalString(openingHoursValidator),
    logo: nullableOptionalString(logoValidator),
    cover: nullableOptionalString(coverValidator),
    whatsapp: nullableOptionalString(whatsappValidator),
    instagram: nullableOptionalString(instagramValidator),
    website: nullableOptionalString(websiteValidator),
    street: nullableOptionalString(streetValidator),
    neighborhood: nullableOptionalString(neighborhoodValidator),
    city: nullableOptionalString(cityValidator),
    state: nullableOptionalString(stateValidator),
    complement: nullableOptionalString(complementValidator),
    zipcode: nullableOptionalString(zipcodeValidator),
    number: nullableOptionalString(numberValidator),
    amenities: z.preprocess((val) => parseAndValidateAmenities(val), z.string().nullable().optional()),
    subcategories: z.preprocess((val) => parseAndValidateSubcategories(val), z.string().nullable().optional())
}).refine((data) => {
    // Se places não foi fornecido, exige que haja dados de endereço estruturado (street, neighborhood ou city)
    if (!data.places && !data.street && !data.neighborhood && !data.city) {
        return false;
    }
    return true;
}, {
    message: "Endereço incorreto / muito curto forneça detalhes do local",
    path: ["places"]
});

// 2. Esquema de Edição (Compartilha validações, limites e formatos exatos)
const editCompanySchema = z.object({
    name: nameValidator.optional(),
    category: categoryValidator.optional(),
    cnpj: cnpjValidator.optional(),
    places: placesValidator.optional(),
    description: nullableOptionalString(descriptionValidator),
    phone: nullableOptionalString(phoneValidator),
    email: nullableOptionalString(emailValidator),
    openingHours: nullableOptionalString(openingHoursValidator),
    logo: nullableOptionalString(logoValidator),
    cover: nullableOptionalString(coverValidator),
    whatsapp: nullableOptionalString(whatsappValidator),
    instagram: nullableOptionalString(instagramValidator),
    website: nullableOptionalString(websiteValidator),
    street: nullableOptionalString(streetValidator),
    neighborhood: nullableOptionalString(neighborhoodValidator),
    city: nullableOptionalString(cityValidator),
    state: nullableOptionalString(stateValidator),
    complement: nullableOptionalString(complementValidator),
    zipcode: nullableOptionalString(zipcodeValidator),
    number: nullableOptionalString(numberValidator),
    amenities: z.preprocess((val) => parseAndValidateAmenities(val), z.string().nullable().optional()),
    subcategories: z.preprocess((val) => parseAndValidateSubcategories(val), z.string().nullable().optional())
});

export async function createCompany(req, res, _next) {
    try {
        if (!req.logged || (req.logged.type !== 'owner' && req.logged.type !== 'admin')) {
            return res.status(403).json({ error: "Acesso negado. Apenas owners podem criar empresas." });
        }

        // Bloqueia evaluate na criação comum: valor inicial é estritamente definido pelo servidor
        if (req.body.evaluate !== undefined && req.body.evaluate !== 0 && req.logged.type !== "admin") {
            return res.status(403).json({
                error: "A avaliação inicial (evaluate) é definida pelo servidor e não pode ser atribuída na criação."
            });
        }

        const adaptedBody = adaptInboundCompanyData(req.body);
        const data = createCompanySchema.parse(adaptedBody);

        // Se places não foi explicitamente enviado, gera a partir dos campos estruturados de forma consistente
        if (!data.places && (data.street || data.neighborhood || data.city)) {
            data.places = composePlaceString(data);
        }

        if (data.cnpj) {
            const cnpjInUse = await prisma.company.findFirst({ where: { cnpj: data.cnpj } });
            if (cnpjInUse) {
                return res.status(409).json({ error: "O CNPJ informado já está em uso" });
            }
        }

        data.userId = Number(req.logged.id);
        data.evaluate = 0; // Garantia de valor inicial padrão

        const c = await prisma.company.create({ data });
        return res.status(201).json(formatCompanyResponse(c));
    } catch (error) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({
                error: error.issues[0]?.message || "Dados inválidos.",
                errors: error.issues.map(e => e.message)
            });
        }
        if (error.message && (error.message.includes("comodidade") || error.message.includes("subcategoria"))) {
            return res.status(400).json({ error: error.message });
        }
        console.error("Erro ao criar empresa:", error);
        return res.status(500).json({ error: "Erro interno no servidor.", details: error.message });
    }
}

export async function readCompany(req, res, _next) {
    try {
        const { name, places, category } = req.query;
        let consult = {};
        if (name) consult.name = { contains: name };
        if (places) consult.places = { contains: places };
        if (category) {
            const normalized = normalizeCategory(category);
            consult.category = { contains: normalized };
        }

        const companies = await prisma.company.findMany({ where: consult });
        return res.status(200).json(companies.map(formatCompanyResponse));
    } catch (error) {
        console.error("Erro ao buscar empresas:", error);
        return res.status(500).json({ error: "Erro interno ao buscar empresas." });
    }
}

export async function editCompany(req, res, _next) {
    try {
        const id = Number(req.params.id);
        if (isNaN(id)) {
            return res.status(400).json({ error: "ID de empresa inválido." });
        }

        const userId = req.logged?.id;
        if (!userId) {
            return res.status(401).json({ error: "Autenticação necessária." });
        }

        const currentCompany = await prisma.company.findFirst({ where: { id: id } });

        if (!currentCompany) {
            return res.status(404).json({ error: `Empresa com id ${id} não encontrada.` });
        }

        const isOwner = currentCompany.userId === userId;
        const isAdmin = req.logged?.type === 'admin';

        if (!isOwner && !isAdmin) {
            return res.status(403).json({ error: "Acesso negado. Você só pode editar as suas próprias empresas." });
        }

        // Bloqueia evaluate em edições comuns de Company (somente admin pode alterar evaluate)
        if (req.body.evaluate !== undefined && !isAdmin) {
            return res.status(403).json({
                error: "Você não tem permissão para alterar a avaliação (evaluate) da empresa."
            });
        }

        const adaptedBody = adaptInboundCompanyData(req.body);

        // Validação Zod explícita restaurada: rejeita tipos incorretos, limites estourados e formatos inválidos
        const validatedData = editCompanySchema.parse(adaptedBody);

        // Verifica unicidade de CNPJ caso tenha sido alterado
        if (validatedData.cnpj && validatedData.cnpj !== currentCompany.cnpj) {
            const cnpjInUse = await prisma.company.findFirst({
                where: { cnpj: validatedData.cnpj, id: { not: id } }
            });
            if (cnpjInUse) {
                return res.status(409).json({ error: "O CNPJ informado já está em uso" });
            }
        }

        // Permite ao admin alterar o evaluate se enviado
        if (req.body.evaluate !== undefined && isAdmin) {
            validatedData.evaluate = Number(req.body.evaluate);
        }

        // =========================================================================
        // REGRAS CENTRALIZADAS DE ENDEREÇO E SINCRONIZAÇÃO EM TRANSAÇÃO ATÔMICA
        // =========================================================================
        const updatedCompany = await prisma.$transaction(async (tx) => {
            // Executa leituras e verificações de consistência diretamente no cliente transacional
            const {
                companyAddressData,
                addressUpdateData,
                targetAddress,
                unequivocalCompaniesToSync
            } = await prepareCompanyAddressUpdate({
                company: currentCompany,
                inbound: adaptedBody,
                loggedUser: req.logged,
                prismaClient: tx
            });

            // Mescla os campos calculados e consistentes de endereço nos dados validados da empresa
            if (companyAddressData && Object.keys(companyAddressData).length > 0) {
                Object.assign(validatedData, companyAddressData);
            }

            const comp = await tx.company.update({
                where: { id: id },
                data: validatedData
            });

            // Gancho para simulação de falha controlada em testes de rollback
            const testHook = getTestTransactionHook();
            if (testHook) {
                await testHook(tx, "afterCompanyUpdate");
            }

            if (targetAddress && addressUpdateData) {
                await tx.address.update({
                    where: { id: targetAddress.id },
                    data: addressUpdateData
                });

                // Mantém consistentes as outras empresas vinculadas cuja projeção de endereço seja inequívoca
                if (unequivocalCompaniesToSync && unequivocalCompaniesToSync.length > 0) {
                    for (const otherComp of unequivocalCompaniesToSync) {
                        await tx.company.update({
                            where: { id: otherComp.id },
                            data: companyAddressData
                        });
                    }
                }
            }

            return comp;
        });

        return res.status(202).json(formatCompanyResponse(updatedCompany));
    } catch (error) {
        if (error instanceof AddressConsistencyError) {
            return res.status(error.statusCode).json({ error: error.message });
        }
        if (error instanceof z.ZodError) {
            return res.status(400).json({
                error: error.issues[0]?.message || "Dados de atualização inválidos.",
                errors: error.issues.map(e => e.message)
            });
        }
        if (error.message && (error.message.includes("comodidade") || error.message.includes("subcategoria"))) {
            return res.status(400).json({ error: error.message });
        }
        console.error("Erro ao editar empresa:", error);
        return res.status(500).json({ error: "Erro interno no servidor ao tentar editar a empresa." });
    }
}

export async function deleteCompany(req, res, _next) {
    try {
        const id = Number(req.params.id);
        if (isNaN(id)) {
            return res.status(400).json({ error: "ID de empresa inválido." });
        }

        const userId = req.logged?.id;
        if (!userId) {
            return res.status(401).json({ error: "Autenticação necessária." });
        }

        const c = await prisma.company.findFirst({ where: { id: id } });
        if (!c) {
            return res.status(404).json({ error: `Empresa com id ${id} não encontrada.` });
        }

        const isOwner = c.userId === userId;
        const isAdmin = req.logged?.type === 'admin';

        if (!isOwner && !isAdmin) {
            return res.status(403).json({ error: "Acesso negado. Você só pode deletar as suas próprias empresas." });
        }

        // Validação de integridade referencial: bloqueia exclusão se houver pagamentos vinculados
        const paymentCount = await prisma.payment.count({
            where: { companyId: id }
        });

        if (paymentCount > 0) {
            return res.status(400).json({
                error: `Não é permitido excluir uma empresa que possua pagamentos vinculados (${paymentCount} registro(s) encontrado(s)). O histórico financeiro e fiscal deve ser preservado.`
            });
        }

        // Exclusão atômica em transação das dependências permitidas
        await prisma.$transaction(async (tx) => {
            await tx.favorite.deleteMany({ where: { companyId: id } });
            await tx.addressCompany.deleteMany({ where: { companyId: id } });
            await tx.company.delete({ where: { id: id } });
        });

        return res.status(200).json({ message: "Empresa deletada com sucesso." });
    } catch (error) {
        console.error("Erro ao deletar empresa:", error);
        return res.status(500).json({ error: "Erro interno no servidor ao tentar excluir a empresa." });
    }
}

export async function showCompany(req, res, _next) {
    try {
        const id = Number(req.params.id);
        if (isNaN(id)) {
            return res.status(400).json({ error: "ID de empresa inválido." });
        }

        const company = await prisma.company.findFirst({
            where: { id: id },
            include: {
                addressCompany: {
                    select: {
                        address: {
                            select: {
                                id: true,
                                place: true,
                                number: true,
                                street: true,
                                neighborhood: true,
                                city: true,
                                state: true,
                                complement: true,
                                zipcode: true,
                                lat: true,
                                long: true,
                                url: true
                            }
                        }
                    }
                }
            }
        });

        if (!company) {
            return res.status(404).json({ error: `Empresa com id ${id} não encontrada.` });
        }

        return res.status(200).json(formatCompanyResponse(company));
    } catch (error) {
        console.error("Erro ao exibir detalhes da empresa:", error);
        return res.status(500).json({ error: "Erro ao buscar a empresa." });
    }
}

export async function favoriteCompany(req, res, _next) {
    try {
        const companyId = Number(req.params.id);
        if (isNaN(companyId)) {
            return res.status(400).json({ error: "ID de empresa inválido." });
        }

        const userId = Number(req.logged?.id);
        if (!userId) {
            return res.status(401).json({ error: "Autenticação necessária." });
        }

        const company = await prisma.company.findUnique({ where: { id: companyId } });
        if (!company) {
            return res.status(404).json({ error: `Empresa com id ${companyId} não encontrada.` });
        }

        const existing = await prisma.favorite.findFirst({
            where: { userId, companyId }
        });

        if (existing) {
            return res.status(409).json({ error: "Esta empresa já está nos seus favoritos." });
        }

        const fav = await prisma.favorite.create({
            data: { userId, companyId }
        });

        return res.status(201).json(fav);
    } catch (error) {
        console.error("Erro ao favoritar empresa:", error);
        return res.status(500).json({ error: "Erro interno ao favoritar empresa." });
    }
}

export async function unfavoriteCompany(req, res, _next) {
    try {
        const companyId = Number(req.params.id);
        if (isNaN(companyId)) {
            return res.status(400).json({ error: "ID de empresa inválido." });
        }

        const userId = Number(req.logged?.id);
        if (!userId) {
            return res.status(401).json({ error: "Autenticação necessária." });
        }

        const existing = await prisma.favorite.findFirst({
            where: { userId, companyId }
        });

        if (!existing) {
            return res.status(404).json({ error: "Esta empresa não está nos seus favoritos." });
        }

        await prisma.favorite.delete({ where: { id: existing.id } });
        return res.status(200).json({ message: "Empresa removida dos seus favoritos com sucesso." });
    } catch (error) {
        console.error("Erro ao desfavoritar empresa:", error);
        return res.status(500).json({ error: "Erro interno ao desfavoritar empresa." });
    }
}

export async function listUserFavorites(req, res, _next) {
    try {
        const userId = Number(req.logged?.id);
        if (!userId) {
            return res.status(401).json({ error: "Autenticação necessária." });
        }

        const favorites = await prisma.favorite.findMany({
            where: { userId },
            include: { company: true }
        });

        const formatted = favorites.map(f => ({
            ...f,
            company: f.company ? formatCompanyResponse(f.company) : null
        }));

        return res.status(200).json(formatted);
    } catch (error) {
        console.error("Erro ao listar favoritos:", error);
        return res.status(500).json({ error: "Erro interno ao listar favoritos." });
    }
}