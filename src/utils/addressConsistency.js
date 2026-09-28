/**
 * Módulo Centralizado de Consistência e Sincronização de Endereços (Company ⟷ Address)
 * 
 * Regras implementadas:
 * 1. Detecção antecipada: se a requisição não contém alterações em places ou nos campos estruturados,
 *    retorna imediatamente sem exigir addressId, sem consultar vínculos e sem disparar checagem de conflitos.
 *    addressId sozinho não provoca sincronização de endereço.
 * 2. Campos omitidos (undefined) preservam valores existentes.
 * 3. null representa remoção SOMENTE em campos que podem ser removidos (opcionais).
 * 4. String vazia ou whitespace segue regra estrita por campo:
 *    - Campos obrigatórios (places, place, number, zipcode quando vinculado): rejeitados com HTTP 400.
 *    - Campos opcionais (street, neighborhood, city, state, complement): interpretados como remoção (null).
 * 5. Validação estrita sem uso de verificações de "valor verdadeiro" (falsy/truthy) para diferenciar
 *    campos omitidos de explicitamente removidos.
 * 6. Regra compartilhada de resolução e detecção de conflitos bidirecional:
 *    - Campo enviado é respeitado (inclusive null para remoção explícita).
 *    - Campo omitido preserva o valor existente em Address; se Address não tiver, preserva o valor
 *      existente em Company.
 *    - Se existirem valores preenchidos e conflitantes em campos omitidos entre Address e Company,
 *      ou entre múltiplas empresas vinculadas, retorna HTTP 409 Conflict.
 * 7. Verificação de todas as empresas do endereço compartilhado:
 *    - Consulta todas as empresas vinculadas ao endereço alvo.
 *    - Valida autorização: se houver empresa de outro proprietário, rejeita com HTTP 403 Forbidden.
 *    - Sincroniza projeções inequívocas vinculadas (empresas com apenas 1 endereço).
 *    - Se uma empresa afetada possuir múltiplos endereços e não for possível determinar a projeção,
 *      retorna HTTP 409 Conflict.
 * 8. Preservação de texto descritivo legado quando faltarem componentes suficientes para recomposição.
 * 9. Não duplica número se o logradouro já contiver o número.
 * 10. Suporte a transações atômicas com cliente transacional (tx).
 */

import prisma from "./prisma.js";

export class AddressConsistencyError extends Error {
    constructor(message, statusCode = 400) {
        super(message);
        this.name = "AddressConsistencyError";
        this.statusCode = statusCode;
    }
}

// Hook controlado exclusivamente para testes de rollback
let testTransactionHook = null;
export function setTestTransactionHook(fn) {
    testTransactionHook = fn;
}
export function getTestTransactionHook() {
    return testTransactionHook;
}

export const STRUCTURED_FIELDS = [
    "street",
    "number",
    "neighborhood",
    "city",
    "state",
    "complement",
    "zipcode"
];

export const OPTIONAL_FIELDS = [
    "street",
    "neighborhood",
    "city",
    "state",
    "complement"
];

export const ADDRESS_INPUT_FIELDS = [
    "places",
    "place",
    "street",
    "number",
    "neighborhood",
    "city",
    "state",
    "complement",
    "zipcode"
];

/**
 * Combina logradouro e número evitando duplicações indesejadas
 * (ex: "Rua das Flores, 123" + "123" => "Rua das Flores, 123").
 */
export function formatStreetWithNumber(street, number) {
    if (!street && !number) return null;
    if (!street) return number ? String(number).trim() : null;
    if (!number) return street.trim();

    const cleanStreet = street.trim();
    const cleanNumber = String(number).trim();

    if (!cleanNumber) return cleanStreet;

    const escapedNumber = cleanNumber.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const trailingNumberPattern = new RegExp(`(?:,\\s*|\\s+n[º°.]?\\s*|\\s+)${escapedNumber}$`, "i");
    const commaNumberPattern = new RegExp(`,\\s*${escapedNumber}(?:\\b|$)`, "i");

    if (trailingNumberPattern.test(cleanStreet) || commaNumberPattern.test(cleanStreet)) {
        return cleanStreet;
    }

    return `${cleanStreet}, ${cleanNumber}`;
}

/**
 * Compõe a string textual representativa do endereço a partir dos campos estruturados.
 */
export function composePlaceString({ street, number, neighborhood, city, state }) {
    const streetPart = formatStreetWithNumber(street, number);
    const parts = [
        streetPart || null,
        neighborhood && neighborhood.trim() ? neighborhood.trim() : null,
        city && city.trim() ? `${city.trim()}${state && state.trim() ? ` - ${state.trim()}` : ""}` : (state && state.trim() ? state.trim() : null)
    ].filter(Boolean);

    if (parts.length === 0) return null;
    return parts.join(", ");
}

/**
 * Valida a string de endereço (places/place).
 * Rejeita nulo, vazio, apenas espaços ou tamanho fora dos limites (3 a 300).
 */
export function validatePlaceString(text, fieldName = "places") {
    if (text === null || text === undefined) {
        throw new AddressConsistencyError(`O campo '${fieldName}' é obrigatório e não pode ser nulo ou removido.`, 400);
    }
    if (typeof text !== "string") {
        throw new AddressConsistencyError(`O campo '${fieldName}' deve ser uma string válida.`, 400);
    }
    const trimmed = text.trim();
    if (trimmed.length === 0) {
        throw new AddressConsistencyError(`O campo '${fieldName}' é obrigatório e não pode ser vazio ou conter apenas espaços.`, 400);
    }
    if (trimmed.length < 3) {
        throw new AddressConsistencyError("Endereço incorreto / muito curto forneça detalhes do local (mínimo 3 caracteres).", 400);
    }
    if (trimmed.length > 300) {
        throw new AddressConsistencyError("Endereço muito longo (máximo 300 caracteres).", 400);
    }
    return trimmed;
}

/**
 * Analisa o valor de entrada para um campo específico de endereço,
 * diferenciando estritamente omitido (undefined), nulo (null), vazio ("") e valor válido.
 */
export function parseFieldInput(input, field, { hasLinkedAddress = false }) {
    if (!(field in input) || input[field] === undefined) {
        return { isProvided: false, value: undefined };
    }

    const raw = input[field];
    const isMandatoryInAddress = field === "number" || field === "zipcode";
    const isPlaceField = field === "places" || field === "place";

    if (raw === null) {
        if (isPlaceField) {
            throw new AddressConsistencyError(`O campo '${field}' é obrigatório e não pode ser nulo ou removido.`, 400);
        }
        if (hasLinkedAddress && isMandatoryInAddress) {
            throw new AddressConsistencyError(`O campo '${field}' é obrigatório no endereço vinculado e não pode ser removido.`, 400);
        }
        return { isProvided: true, value: null };
    }

    if (typeof raw === "string") {
        const trimmed = raw.trim();
        if (trimmed === "" || trimmed === "null") {
            if (isPlaceField) {
                throw new AddressConsistencyError(`O campo '${field}' é obrigatório e não pode ser vazio ou conter apenas espaços.`, 400);
            }
            if (hasLinkedAddress && isMandatoryInAddress) {
                throw new AddressConsistencyError(`O campo '${field}' é obrigatório no endereço vinculado e não pode ser vazio.`, 400);
            }
            return { isProvided: true, value: null };
        }
        return { isProvided: true, value: trimmed };
    }

    const stringified = String(raw).trim();
    if (stringified === "") {
        if (isPlaceField || (hasLinkedAddress && isMandatoryInAddress)) {
            throw new AddressConsistencyError(`O campo '${field}' é obrigatório e não pode ser vazio.`, 400);
        }
        return { isProvided: true, value: null };
    }
    return { isProvided: true, value: stringified };
}

/**
 * Compara valores pré-existentes para detectar conflitos reais entre Address e Company.
 */
export function areValuesConflicting(field, valComp, valAddr) {
    if (!valComp || !valAddr) return false;
    const strComp = String(valComp).trim();
    const strAddr = String(valAddr).trim();
    if (!strComp || !strAddr) return false;

    if (field === "zipcode") {
        const cleanComp = strComp.replace(/\D/g, "");
        const cleanAddr = strAddr.replace(/\D/g, "");
        return cleanComp !== cleanAddr;
    }

    return strComp.toLowerCase() !== strAddr.toLowerCase();
}

/**
 * Regra compartilhada de resolução e detecção de conflitos:
 * - Para cada campo estruturado:
 *   - Se fornecido na requisição: respeita a alteração recebida (incluindo null para remoção).
 *   - Se omitido: analisa todos os registros vinculados (Address e Empresas vinculadas).
 *     - Se houver valores preenchidos e divergentes entre os registros, lança HTTP 409 Conflict.
 *     - Se houver valor em Address, preserva de Address.
 *     - Se Address não tiver e houver valor em Company, preserva de Company.
 */
export function resolveConsistentStructuredData({
    records,
    inbound,
    hasLinkedAddress = false
}) {
    const parsedInputs = {};
    for (const f of STRUCTURED_FIELDS) {
        parsedInputs[f] = parseFieldInput(inbound, f, { hasLinkedAddress });
    }

    const merged = {};

    for (const f of STRUCTURED_FIELDS) {
        if (parsedInputs[f].isProvided) {
            // Valor explicitamente enviado (novo valor ou remoção)
            merged[f] = parsedInputs[f].value;
        } else {
            // Campo omitido: verifica valores existentes em todos os registros
            const presentValues = [];
            for (const rec of records) {
                if (!rec || !rec.data) continue;
                const val = rec.data[f];
                if (val !== null && val !== undefined && String(val).trim() !== "") {
                    presentValues.push({
                        type: rec.type,
                        name: rec.data.name || rec.type,
                        value: val
                    });
                }
            }

            // Verifica se há conflito entre quaisquer dois registros
            for (let i = 0; i < presentValues.length; i++) {
                for (let j = i + 1; j < presentValues.length; j++) {
                    if (areValuesConflicting(f, presentValues[i].value, presentValues[j].value)) {
                        throw new AddressConsistencyError(
                            `Conflito de dados de endereço entre os registros vinculados no campo '${f}' ('${presentValues[i].value}' vs '${presentValues[j].value}'). Envie explicitamente o campo '${f}' na requisição para resolver a divergência.`,
                            409
                        );
                    }
                }
            }

            // Se não há conflito, prioriza Address se tiver o valor; senão usa de Company
            if (presentValues.length > 0) {
                const addrVal = presentValues.find(p => p.type === "address");
                merged[f] = addrVal ? addrVal.value : presentValues[0].value;
            } else {
                merged[f] = null;
            }
        }
    }

    return { mergedStructured: merged, parsedInputs };
}

/**
 * Seleciona o Address alvo antes de qualquer combinação de dados,
 * validando ownership e integridade de múltiplos endereços.
 */
export async function resolveTargetAddress(companyId, inboundAddressId, prismaClient = prisma) {
    const addressLinks = await prismaClient.addressCompany.findMany({
        where: { companyId },
        include: { address: { include: { users: true } } }
    });

    if (addressLinks.length === 0) {
        if (inboundAddressId !== undefined && inboundAddressId !== null && inboundAddressId !== "") {
            throw new AddressConsistencyError(
                `A empresa não possui endereços vinculados e o addressId informado (${inboundAddressId}) é inválido.`,
                400
            );
        }
        return { targetAddress: null, addressLinks: [] };
    }

    if (addressLinks.length === 1) {
        const singleLink = addressLinks[0];
        if (inboundAddressId !== undefined && inboundAddressId !== null && inboundAddressId !== "") {
            const parsedId = Number(inboundAddressId);
            if (isNaN(parsedId) || parsedId !== singleLink.addressId) {
                throw new AddressConsistencyError(
                    `O endereço com addressId ${inboundAddressId} não está vinculado a esta empresa.`,
                    400
                );
            }
        }
        return { targetAddress: singleLink.address, addressLinks };
    }

    // Múltiplos vínculos (> 1)
    if (inboundAddressId === undefined || inboundAddressId === null || inboundAddressId === "") {
        throw new AddressConsistencyError(
            "A empresa possui múltiplos endereços vinculados. Informe 'addressId' para identificar qual endereço comercial deve ser atualizado.",
            400
        );
    }

    const parsedId = Number(inboundAddressId);
    if (isNaN(parsedId)) {
        throw new AddressConsistencyError("ID de endereço (addressId) inválido.", 400);
    }

    const matchedLink = addressLinks.find(l => l.addressId === parsedId);
    if (!matchedLink) {
        throw new AddressConsistencyError(
            `O endereço com addressId ${parsedId} não está vinculado a esta empresa.`,
            400
        );
    }

    return { targetAddress: matchedLink.address, addressLinks };
}

/**
 * Prepara a atualização consistente iniciada a partir da Empresa (editCompany).
 * Executa dentro da transação atômica do Prisma (prismaClient = tx).
 */
export async function prepareCompanyAddressUpdate({
    company,
    inbound,
    loggedUser,
    prismaClient = prisma
}) {
    // 1. DETECÇÃO ANTECIPADA: Se a requisição não contém campos de endereço,
    // retorna imediatamente sem consultar vínculos, exigir addressId ou verificar conflitos.
    // addressId sozinho não provoca sincronização de endereço.
    const hasAnyAddressField = ADDRESS_INPUT_FIELDS.some(
        f => f in inbound && inbound[f] !== undefined
    );

    if (!hasAnyAddressField) {
        return {
            companyAddressData: {},
            addressUpdateData: null,
            targetAddress: null,
            unequivocalCompaniesToSync: []
        };
    }

    // 2. Validações preliminares de rejeição imediata de places (null, vazio, espaços)
    if ("places" in inbound) {
        if (inbound.places === null || (typeof inbound.places === "string" && inbound.places.trim() === "")) {
            throw new AddressConsistencyError("O campo 'places' é obrigatório e não pode ser nulo, vazio ou conter apenas espaços.", 400);
        }
    }

    // 3. Seleciona o Address alvo
    const inboundAddressId = inbound.addressId;
    const { targetAddress } = await resolveTargetAddress(company.id, inboundAddressId, prismaClient);

    const hasLinkedAddress = Boolean(targetAddress);
    const unequivocalCompaniesToSync = [];

    // 4. Verificação de todas as empresas do endereço compartilhado e validação de permissões
    if (targetAddress) {
        // Valida se o usuário tem autorização sobre o endereço
        if (targetAddress.users && targetAddress.users.length > 0) {
            const isAddressOwner = targetAddress.users.some(u => u.id === loggedUser.id);
            const isAdmin = loggedUser.type === "admin";
            if (!isAddressOwner && !isAdmin) {
                throw new AddressConsistencyError("Acesso negado. O endereço comercial selecionado pertence a outro usuário.", 403);
            }
        }

        // Consulta todas as empresas vinculadas a esse endereço
        const linkedCompanyLinks = await prismaClient.addressCompany.findMany({
            where: { addressId: targetAddress.id },
            include: {
                company: {
                    include: {
                        addressCompany: true
                    }
                }
            }
        });

        // Valida autorização de cada empresa vinculada
        const isAdmin = loggedUser.type === "admin";
        for (const link of linkedCompanyLinks) {
            const linkedComp = link.company;
            if (!linkedComp) continue;

            if (linkedComp.userId !== loggedUser.id && !isAdmin) {
                throw new AddressConsistencyError(
                    `Acesso negado. O endereço está vinculado à empresa '${linkedComp.name}', que pertence a outro usuário.`,
                    403
                );
            }

            // Se for outra empresa diferente da empresa sendo editada
            if (linkedComp.id !== company.id) {
                if (linkedComp.addressCompany && linkedComp.addressCompany.length > 1) {
                    throw new AddressConsistencyError(
                        `A empresa vinculada '${linkedComp.name}' (ID: ${linkedComp.id}) possui múltiplos endereços cadastrados (${linkedComp.addressCompany.length}) e o modelo atual não define qual endereço é a projeção principal. A sincronização causaria sobreposição ambígua na empresa.`,
                        409
                    );
                }
                unequivocalCompaniesToSync.push(linkedComp);
            }
        }
    }

    // 5. Combinação e detecção de conflitos compartilhada
    const records = [];
    if (targetAddress) {
        records.push({ type: "address", data: targetAddress });
    }
    records.push({ type: "company", data: company });
    for (const otherComp of unequivocalCompaniesToSync) {
        records.push({ type: "company", data: otherComp });
    }

    const { mergedStructured, parsedInputs } = resolveConsistentStructuredData({
        records,
        inbound,
        hasLinkedAddress
    });

    const parsedPlaces = "places" in inbound
        ? parseFieldInput(inbound, "places", { hasLinkedAddress })
        : { isProvided: false, value: undefined };

    // 6. Determinação de places final e preservação de texto legado
    const anyStructuredChanged = STRUCTURED_FIELDS.some(f => parsedInputs[f].isProvided);
    const hasStructuredSufficientForComposition = Boolean(
        mergedStructured.street || (mergedStructured.neighborhood && mergedStructured.city && mergedStructured.number)
    );

    let finalPlaces = null;
    if (parsedPlaces.isProvided && (!anyStructuredChanged || !hasStructuredSufficientForComposition)) {
        finalPlaces = parsedPlaces.value;
    } else if (anyStructuredChanged && hasStructuredSufficientForComposition) {
        finalPlaces = composePlaceString(mergedStructured);
    } else if (parsedPlaces.isProvided) {
        finalPlaces = parsedPlaces.value;
    } else {
        // Preserva texto legado existente
        if (company.places && company.places.trim() !== "") {
            finalPlaces = company.places;
        } else if (hasLinkedAddress && targetAddress.place && targetAddress.place.trim() !== "") {
            finalPlaces = targetAddress.place;
        } else {
            finalPlaces = composePlaceString(mergedStructured);
        }
    }

    const validatedPlaceText = validatePlaceString(finalPlaces, "places");

    // 7. Payloads prontos para persistência
    const companyAddressData = {
        places: validatedPlaceText,
        street: mergedStructured.street,
        number: mergedStructured.number,
        neighborhood: mergedStructured.neighborhood,
        city: mergedStructured.city,
        state: mergedStructured.state,
        complement: mergedStructured.complement,
        zipcode: mergedStructured.zipcode
    };

    let addressUpdateData = null;
    if (hasLinkedAddress) {
        addressUpdateData = {
            place: validatedPlaceText,
            street: mergedStructured.street,
            number: String(mergedStructured.number),
            neighborhood: mergedStructured.neighborhood,
            city: mergedStructured.city,
            state: mergedStructured.state,
            complement: mergedStructured.complement,
            zipcode: String(mergedStructured.zipcode)
        };
    }

    return {
        companyAddressData,
        addressUpdateData,
        targetAddress,
        unequivocalCompaniesToSync
    };
}

/**
 * Prepara a atualização consistente iniciada a partir do Endereço (editAddress).
 * Executa dentro da transação atômica do Prisma (prismaClient = tx).
 */
export async function prepareAddressDirectUpdate({
    addressId,
    inbound,
    loggedUser,
    prismaClient = prisma
}) {
    // 1. Busca o endereço existente com seus donos e empresas vinculadas
    const existingAddress = await prismaClient.address.findUnique({
        where: { id: addressId },
        include: {
            users: true,
            addressCompany: {
                include: {
                    company: {
                        include: {
                            addressCompany: true
                        }
                    }
                }
            }
        }
    });

    if (!existingAddress) {
        throw new AddressConsistencyError(`Endereço com id ${addressId} não existe e não pode ser editado.`, 404);
    }

    // 2. Valida autorização do usuário sobre o endereço
    const isOwner = existingAddress.users.some(u => u.id === loggedUser.id);
    const isAdmin = loggedUser.type === "admin";

    if (!isOwner && !isAdmin) {
        throw new AddressConsistencyError("Acesso negado. Somente o dono deste endereço pode fazer alterações.", 403);
    }

    // 3. Valida autorização sobre todas as empresas vinculadas e impede sobreposição ambígua
    const linkedCompaniesToSync = [];

    for (const link of existingAddress.addressCompany) {
        const comp = link.company;
        if (!comp) continue;

        if (comp.userId !== loggedUser.id && !isAdmin) {
            throw new AddressConsistencyError(
                `Acesso negado. O endereço está vinculado à empresa '${comp.name}', que pertence a outro usuário.`,
                403
            );
        }

        if (comp.addressCompany && comp.addressCompany.length > 1) {
            throw new AddressConsistencyError(
                `A empresa vinculada '${comp.name}' (ID: ${comp.id}) possui múltiplos endereços cadastrados (${comp.addressCompany.length}) e o modelo atual não define qual endereço é a projeção principal. A edição direta deste endereço causaria sobreposição ambígua na empresa. Atualize o endereço através da edição da empresa especificando 'addressId'.`,
                409
            );
        }

        linkedCompaniesToSync.push(comp);
    }

    // 4. Combinação e detecção de conflitos compartilhada
    const records = [
        { type: "address", data: existingAddress },
        ...linkedCompaniesToSync.map(comp => ({ type: "company", data: comp }))
    ];

    const { mergedStructured, parsedInputs } = resolveConsistentStructuredData({
        records,
        inbound,
        hasLinkedAddress: true
    });

    const parsedPlace = "place" in inbound
        ? parseFieldInput(inbound, "place", { hasLinkedAddress: true })
        : ("places" in inbound ? parseFieldInput(inbound, "places", { hasLinkedAddress: true }) : { isProvided: false, value: undefined });

    // 5. Composição de place e preservação de texto legado
    const anyStructuredChanged = STRUCTURED_FIELDS.some(f => parsedInputs[f].isProvided);
    const hasStructuredSufficientForComposition = Boolean(
        mergedStructured.street || (mergedStructured.neighborhood && mergedStructured.city && mergedStructured.number)
    );

    let finalPlace = null;
    if (parsedPlace.isProvided && (!anyStructuredChanged || !hasStructuredSufficientForComposition)) {
        finalPlace = parsedPlace.value;
    } else if (anyStructuredChanged && hasStructuredSufficientForComposition) {
        finalPlace = composePlaceString(mergedStructured);
    } else if (parsedPlace.isProvided) {
        finalPlace = parsedPlace.value;
    } else {
        // Preserva o texto existente mais relevante
        const existingText = existingAddress.place ||
            (linkedCompaniesToSync.length > 0 && linkedCompaniesToSync[0].places);
        if (existingText && existingText.trim() !== "") {
            finalPlace = existingText;
        } else {
            finalPlace = composePlaceString(mergedStructured);
        }
    }

    const validatedPlaceText = validatePlaceString(finalPlace, "place");

    // 6. Payloads prontos para persistência
    const addressUpdateData = {
        place: validatedPlaceText,
        street: mergedStructured.street,
        number: String(mergedStructured.number),
        neighborhood: mergedStructured.neighborhood,
        city: mergedStructured.city,
        state: mergedStructured.state,
        complement: mergedStructured.complement,
        zipcode: String(mergedStructured.zipcode)
    };

    if (inbound.lat !== undefined && inbound.lat !== null && inbound.lat !== "") {
        addressUpdateData.lat = parseFloat(inbound.lat);
    }
    if (inbound.long !== undefined && inbound.long !== null && inbound.long !== "") {
        addressUpdateData.long = parseFloat(inbound.long);
    }

    const companySyncData = {
        places: validatedPlaceText,
        street: mergedStructured.street,
        number: mergedStructured.number,
        neighborhood: mergedStructured.neighborhood,
        city: mergedStructured.city,
        state: mergedStructured.state,
        complement: mergedStructured.complement,
        zipcode: mergedStructured.zipcode
    };

    return {
        existingAddress,
        addressUpdateData,
        linkedCompaniesToSync,
        companySyncData
    };
}
