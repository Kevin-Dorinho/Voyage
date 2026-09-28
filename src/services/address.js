import prisma from "../utils/prisma.js";
import { z } from "zod";
import { uploadToImgBB } from "../utils/uploader.js";
import { formatCompanyResponse } from "./company.js";
import {
    prepareAddressDirectUpdate,
    composePlaceString,
    AddressConsistencyError,
    getTestTransactionHook
} from "../utils/addressConsistency.js";

export function adaptInboundAddressData(raw) {
    if (!raw || typeof raw !== "object") return raw;
    const body = { ...raw };

    if (body.rua !== undefined && body.street === undefined) body.street = body.rua;
    if (body.logradouro !== undefined && body.street === undefined) body.street = body.logradouro;
    if (body.numero !== undefined && body.number === undefined) body.number = body.numero;
    if (body.cep !== undefined && body.zipcode === undefined) body.zipcode = body.cep;
    if (body.bairro !== undefined && body.neighborhood === undefined) body.neighborhood = body.bairro;
    if (body.cidade !== undefined && body.city === undefined) body.city = body.cidade;
    if (body.estado !== undefined && body.state === undefined) body.state = body.estado;
    if (body.uf !== undefined && body.state === undefined) body.state = body.uf;
    if (body.complemento !== undefined && body.complement === undefined) body.complement = body.complemento;

    if (!body.place && body.street) {
        body.place = composePlaceString(body) || body.street;
    }

    return body;
}

export function formatAddressResponse(addr) {
    if (!addr || typeof addr !== "object") return addr;

    const formatted = {
        ...addr,
        street: addr.street || null,
        rua: addr.street || addr.place || null,
        numero: addr.number || null,
        cep: addr.zipcode || null,
        neighborhood: addr.neighborhood || null,
        bairro: addr.neighborhood || null,
        city: addr.city || null,
        cidade: addr.city || null,
        state: addr.state || null,
        estado: addr.state || null,
        uf: addr.state || null,
        complement: addr.complement || null,
        complemento: addr.complement || null
    };

    if (Array.isArray(formatted.addressCompany)) {
        formatted.addressCompany = formatted.addressCompany.map(ac => ({
            ...ac,
            company: ac.company ? formatCompanyResponse(ac.company) : ac.company
        }));
    }

    return formatted;
}

const createAddressSchema = z.object({
    place: z.string({ required_error: "O endereço é obrigatório." })
        .min(3, "O endereço deve ter no mínimo 3 caracteres.")
        .regex(/^[a-zA-ZÀ-ÿ0-9\s,.\-]+$/, "O endereço não pode conter caracteres especiais anormais."),
    number: z.string({ required_error: "O número é obrigatório." })
        .min(1, "O número é obrigatório.")
        .regex(/^\d{1,6}(?:\s?[a-zA-Z])?$/, "O número deve ter até 6 números e no máximo uma letra (ex: 102 F ou 123 b)."),
    zipcode: z.string({ required_error: "O CEP é obrigatório." })
        .regex(/^\d{5}-?\d{3}$/, "CEP inválido. Use o formato 00000-000."),
    street: z.string().nullable().optional(),
    neighborhood: z.string().nullable().optional(),
    city: z.string().nullable().optional(),
    state: z.string().nullable().optional(),
    complement: z.string().nullable().optional(),
    lat: z.preprocess(
        (val) => {
            const parsed = parseFloat(val);
            return isNaN(parsed) ? val : parsed;
        },
        z.number({ invalid_type_error: "Latitude inválida." })
            .min(-90, "Latitude inválida. Deve estar entre -90 e 90.")
            .max(90, "Latitude inválida. Deve estar entre -90 e 90.")
    ),
    long: z.preprocess(
        (val) => {
            const parsed = parseFloat(val);
            return isNaN(parsed) ? val : parsed;
        },
        z.number({ invalid_type_error: "Longitude inválida." })
            .min(-180, "Longitude inválida. Deve estar entre -180 e 180.")
            .max(180, "Longitude inválida. Deve estar entre -180 e 180.")
    ),
    companyId: z.preprocess(
        (val) => (val !== undefined && val !== null && val !== "" ? Number(val) : undefined),
        z.number().int().positive().optional()
    )
});

const editAddressSchema = z.object({
    place: z.string()
        .min(3, "O endereço deve ter no mínimo 3 caracteres.")
        .regex(/^[a-zA-ZÀ-ÿ0-9\s,.\-]+$/, "O endereço não pode conter caracteres especiais anormais.")
        .optional(),
    number: z.string()
        .regex(/^\d{1,6}(?:\s?[a-zA-Z])?$/, "O número deve ter até 6 números e no máximo uma letra (ex: 102 F ou 123 b).")
        .optional(),
    zipcode: z.string()
        .regex(/^\d{5}-?\d{3}$/, "CEP inválido. Use o formato 00000-000.")
        .optional(),
    street: z.string().nullable().optional(),
    neighborhood: z.string().nullable().optional(),
    city: z.string().nullable().optional(),
    state: z.string().nullable().optional(),
    complement: z.string().nullable().optional(),
    lat: z.preprocess(
        (val) => {
            if (val === undefined || val === null || val === "") return undefined;
            const parsed = parseFloat(val);
            return isNaN(parsed) ? val : parsed;
        },
        z.number({ invalid_type_error: "Latitude inválida." })
            .min(-90, "Latitude inválida. Deve estar entre -90 e 90.")
            .max(90, "Latitude inválida. Deve estar entre -90 e 90.")
            .optional()
    ),
    long: z.preprocess(
        (val) => {
            if (val === undefined || val === null || val === "") return undefined;
            const parsed = parseFloat(val);
            return isNaN(parsed) ? val : parsed;
        },
        z.number({ invalid_type_error: "Longitude inválida." })
            .min(-180, "Longitude inválida. Deve estar entre -180 e 180.")
            .max(180, "Longitude inválida. Deve estar entre -180 e 180.")
            .optional()
    )
});

export async function createAddress(req, res, _next) {
    try {
        if (!req.logged || !req.logged.id) {
            return res.status(401).json({ error: "Autenticação necessária para cadastrar endereço." });
        }

        const adaptedBody = adaptInboundAddressData(req.body);
        const validation = createAddressSchema.safeParse(adaptedBody);

        if (!validation.success) {
            return res.status(400).json({
                error: "Dados de endereço inválidos.",
                detalhes: validation.error.format()
            });
        }

        const data = validation.data;

        if (!req.file) {
            return res.status(400).json({
                error: "É obrigatório enviar uma imagem (preferencialmente o logo da empresa ou uma foto nítida do local)."
            });
        }

        // Validação estrita de empresa ANTES de fazer qualquer upload para o provedor
        if (data.companyId) {
            const company = await prisma.company.findUnique({
                where: { id: data.companyId }
            });

            if (!company) {
                return res.status(404).json({ error: `Empresa com id ${data.companyId} não encontrada.` });
            }

            const isCompanyOwner = company.userId === Number(req.logged.id);
            const isAdmin = req.logged.type === "admin";

            if (!isCompanyOwner && !isAdmin) {
                return res.status(403).json({ error: "Acesso negado. A empresa informada não pertence a você." });
            }
        }

        // Upload somente é executado após validação completa de dados e autorização
        const imageUrl = await uploadToImgBB(req.file);

        const createData = {
            place: data.place,
            number: data.number,
            zipcode: data.zipcode,
            street: data.street || null,
            neighborhood: data.neighborhood || null,
            city: data.city || null,
            state: data.state || null,
            complement: data.complement || null,
            lat: data.lat,
            long: data.long,
            url: imageUrl || "",
            users: {
                connect: { id: Number(req.logged.id) }
            }
        };

        if (data.companyId) {
            createData.addressCompany = {
                create: { companyId: data.companyId }
            };
        }

        const address = await prisma.address.create({
            data: createData
        });

        return res.status(201).json(formatAddressResponse(address));
    } catch (error) {
        console.error("Erro ao criar endereço:", error);
        return res.status(500).json({ error: error.message || "Erro interno ao cadastrar endereço." });
    }
}

export async function readAddress(req, res, _next) {
    try {
        const { lat, long, user, category, company, favorite, radius } = req.query;

        let consult = {};

        if (lat && long) {
            const latitude = parseFloat(lat);
            const longitude = parseFloat(long);

            if (isNaN(latitude) || latitude < -90 || latitude > 90 ||
                isNaN(longitude) || longitude < -180 || longitude > 180) {
                return res.status(400).json({ error: "Latitude ou Longitude em formato inválido ou fora dos limites." });
            }

            let r = 0.05; // ~5km padrão
            if (radius !== undefined) {
                const parsedRadius = parseFloat(radius);
                if (isNaN(parsedRadius) || parsedRadius <= 0) {
                    return res.status(400).json({ error: "Raio de busca inválido. Deve ser um número positivo." });
                }
                r = parsedRadius;
            }

            consult.lat = {
                gte: latitude - r,
                lte: latitude + r
            };
            consult.long = {
                gte: longitude - r,
                lte: longitude + r
            };
        } else if (lat) {
            const latitude = parseFloat(lat);
            if (isNaN(latitude) || latitude < -90 || latitude > 90) {
                return res.status(400).json({ error: "Latitude inválida." });
            }
            consult.lat = { equals: latitude };
        } else if (long) {
            const longitude = parseFloat(long);
            if (isNaN(longitude) || longitude < -180 || longitude > 180) {
                return res.status(400).json({ error: "Longitude inválida." });
            }
            consult.long = { equals: longitude };
        }

        if (user) {
            const userId = parseInt(user);
            if (isNaN(userId)) {
                return res.status(400).json({ error: "ID de usuário inválido." });
            }
            consult.users = { some: { id: userId } };
        }

        const companyConditions = [];

        if (company) {
            const companyId = parseInt(company);
            if (isNaN(companyId)) {
                return res.status(400).json({ error: "ID de empresa inválido." });
            }
            companyConditions.push({ companyId });
        }

        if (category) {
            const categoryExists = await prisma.company.findFirst({
                where: { category: { equals: category } }
            });

            if (!categoryExists) {
                return res.status(404).json({ error: `A categoria '${category}' não existe em nenhuma empresa cadastrada.` });
            }

            companyConditions.push({ company: { category: { equals: category } } });
        }

        if (favorite !== undefined && favorite !== null && favorite !== "") {
            if (!req.logged || !req.logged.id) {
                return res.status(401).json({ error: "Autenticação necessária para consultar favoritos." });
            }

            const loggedId = Number(req.logged.id);
            const favParam = parseInt(favorite);

            // Bloqueia tentativas de terceiros de espionar favoritos de outro usuário
            if (!isNaN(favParam) && favParam !== loggedId && req.logged.type !== "admin") {
                return res.status(403).json({ error: "Acesso negado. Você só pode consultar os seus próprios favoritos." });
            }

            companyConditions.push({ company: { favorites: { some: { userId: loggedId } } } });
        }

        // Política de privacidade estrita: consultas públicas retornam SOMENTE endereços comerciais
        // associados a empresas explicitamente destinados à divulgação.
        // Parâmetros user ou company não podem contornar essa política.
        consult.addressCompany = {
            some: companyConditions.length > 0 ? { AND: companyConditions } : {}
        };

        const address = await prisma.address.findMany({
            where: consult,
            include: {
                addressCompany: {
                    include: {
                        company: true
                    }
                }
            }
        });

        return res.status(200).json(address.map(formatAddressResponse));
    } catch (error) {
        console.error("Erro ao ler endereços:", error);
        return res.status(500).json({ error: "Erro interno ao buscar endereços." });
    }
}

export async function showAddress(req, res, _next) {
    try {
        const id = Number(req.params.id);

        if (isNaN(id)) return res.status(400).json({ error: "ID de endereço inválido." });

        // Seleção explícita dos campos necessários: NÃO expõe usuários, senhas ou dados sensíveis em consultas públicas
        const a = await prisma.address.findUnique({
            where: { id: id },
            select: {
                id: true,
                place: true,
                number: true,
                zipcode: true,
                street: true,
                neighborhood: true,
                city: true,
                state: true,
                complement: true,
                lat: true,
                long: true,
                url: true,
                createdAt: true,
                updatedAt: true,
                users: {
                    select: { id: true }
                },
                addressCompany: {
                    select: {
                        id: true,
                        companyId: true,
                        company: {
                            select: {
                                id: true,
                                name: true,
                                category: true,
                                evaluate: true,
                                places: true,
                                description: true,
                                phone: true,
                                email: true,
                                openingHours: true,
                                logo: true,
                                whatsapp: true,
                                instagram: true,
                                website: true,
                                subcategories: true,
                                cover: true,
                                amenities: true,
                                street: true,
                                neighborhood: true,
                                city: true,
                                state: true,
                                complement: true,
                                zipcode: true,
                                number: true
                            }
                        }
                    }
                }
            }
        });

        if (!a) {
            return res.status(404).json({ error: "Endereço não encontrado." });
        }

        const isCommercial = a.addressCompany && a.addressCompany.length > 0;
        if (!isCommercial) {
            // Endereço pessoal privado: consultas públicas não podem visualizá-lo.
            // Apenas o próprio dono autenticado ou um administrador podem acessá-lo.
            const isOwner = req.logged && a.users && a.users.some(u => u.id === Number(req.logged.id));
            const isAdmin = req.logged && req.logged.type === "admin";

            if (!isOwner && !isAdmin) {
                return res.status(404).json({ error: "Endereço não encontrado." });
            }
        }

        // Sanitiza a relação users da resposta para nunca expor relação de usuários
        const { users: _users, ...publicAddress } = a;
        return res.status(200).json(formatAddressResponse(publicAddress));
    } catch (error) {
        console.error("Erro ao buscar detalhes do endereço:", error);
        return res.status(500).json({ error: "Erro ao buscar detalhes do endereço." });
    }
}

export async function editAddress(req, res, _next) {
    try {
        const id = Number(req.params.id);

        if (isNaN(id)) return res.status(400).json({ error: "ID de endereço inválido." });

        const adaptedBody = adaptInboundAddressData(req.body);
        const validation = editAddressSchema.safeParse(adaptedBody);

        if (!validation.success) {
            return res.status(400).json({
                error: "Dados de atualização inválidos.",
                detalhes: validation.error.format()
            });
        }

        const loggedUser = req.logged;
        if (!loggedUser || !loggedUser.id) {
            return res.status(401).json({ error: "Autenticação necessária." });
        }

        // 1. Upload externo de arquivo é realizado ANTES de abrir a transação
        let uploadedUrl = null;
        if (req.file) {
            const existingAddress = await prisma.address.findUnique({
                where: { id: id },
                include: { users: true }
            });
            if (!existingAddress) {
                return res.status(404).json({ error: `Endereço com id ${id} não existe e não pode ser editado.` });
            }
            const isOwner = existingAddress.users.some(user => user.id === loggedUser.id);
            const isAdmin = loggedUser.type === "admin";
            if (!isOwner && !isAdmin) {
                return res.status(403).json({ error: "Acesso negado. Somente o dono deste endereço pode fazer alterações." });
            }

            uploadedUrl = await uploadToImgBB(req.file);
        }

        // 2. Executa leituras, verificações de consistência e gravações na mesma transação atômica
        const updatedAddress = await prisma.$transaction(async (tx) => {
            const {
                addressUpdateData,
                linkedCompaniesToSync,
                companySyncData
            } = await prepareAddressDirectUpdate({
                addressId: id,
                inbound: adaptedBody,
                loggedUser,
                prismaClient: tx
            });

            if (uploadedUrl) {
                addressUpdateData.url = uploadedUrl;
            }

            const addr = await tx.address.update({
                where: { id: id },
                data: addressUpdateData
            });

            // Gancho para simulação de falha controlada em testes de rollback
            const testHook = getTestTransactionHook();
            if (testHook) {
                await testHook(tx, "afterAddressUpdate");
            }

            for (const comp of linkedCompaniesToSync) {
                await tx.company.update({
                    where: { id: comp.id },
                    data: companySyncData
                });
            }

            return addr;
        });

        return res.status(202).json(formatAddressResponse(updatedAddress));
    } catch (error) {
        if (error instanceof AddressConsistencyError) {
            return res.status(error.statusCode).json({ error: error.message });
        }
        console.error("Erro ao editar o endereço:", error);
        return res.status(500).json({ error: "Erro interno no servidor ao tentar editar o endereço." });
    }
}

export async function deleteAddress(req, res, _next) {
    try {
        const id = Number(req.params.id);

        if (isNaN(id)) return res.status(400).json({ error: "ID de endereço inválido." });

        const existingAddress = await prisma.address.findUnique({
            where: { id: id },
            include: { users: true }
        });

        if (!existingAddress) {
            return res.status(404).json({ error: `Falha na exclusão: Endereço com id ${id} não encontrado.` });
        }

        const loggedId = Number(req.logged.id);
        const isOwner = existingAddress.users.some(user => user.id === loggedId);
        const isAdmin = req.logged.type === "admin";

        if (!isOwner && !isAdmin) {
            return res.status(403).json({ error: "Acesso negado. Somente o dono deste endereço pode deletá-lo." });
        }

        // Remove vínculos para preservar integridade
        await prisma.addressCompany.deleteMany({ where: { addressId: id } });
        await prisma.address.delete({ where: { id: id } });

        return res.status(200).json({ message: `Endereço com id ${id} deletado com sucesso.` });
    } catch (error) {
        console.error("Erro ao deletar o endereço:", error);
        return res.status(500).json({ error: "Erro interno ao tentar deletar o endereço." });
    }
}
