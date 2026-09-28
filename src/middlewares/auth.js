
import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../utils/config.js';
import prisma from '../utils/prisma.js';

export const auth = async (req, res, next) => {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
        return res.status(401).json({ error: 'Token de autenticação não foi inserido no header' });
    }

    const parts = authHeader.split(' ');

    if (parts.length !== 2 || parts[0] !== 'Bearer') {
        return res.status(401).json({ error: 'Formato do token incorreto. Use: Bearer <token>' });
    }

    const token = parts[1];

    try {
        const decoded = jwt.verify(token, JWT_SECRET);

        // Valida que o identificador do token é um número inteiro positivo
        const rawId = decoded.sub !== undefined ? decoded.sub : decoded.id;
        const userId = Number(rawId);
        if (!Number.isInteger(userId) || userId <= 0) {
            return res.status(401).json({ error: 'Token contém identificador inválido' });
        }

        // Verifica se o usuário ainda existe no banco e usa o perfil ATUAL
        // para decisões de autorização (não depende de dados antigos do token)
        const currentUser = await prisma.user.findFirst({ where: { id: userId } });

        if (!currentUser) {
            return res.status(401).json({ error: 'Usuário associado ao token não existe mais' });
        }

        // Anexa as informações ATUAIS do banco na requisição
        req.logged = {
            id: currentUser.id,
            type: currentUser.type,
            email: currentUser.email,
            name: currentUser.name
        };

        // Passa para as Rotas (e consequentemente para o Service)
        return next();
    } catch (err) {
        return res.status(401).json({ error: 'Token inválido ou expirado' });
    }
};

/**
 * Middleware de autenticação opcional: se o token estiver presente e válido, injeta req.logged.
 * Se não houver token, prossegue normalmente sem req.logged para rotas de leitura pública.
 */
export const optionalAuth = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return next();
    }

    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
        return next();
    }

    try {
        const decoded = jwt.verify(parts[1], JWT_SECRET);
        const rawId = decoded.sub !== undefined ? decoded.sub : decoded.id;
        const userId = Number(rawId);
        if (Number.isInteger(userId) && userId > 0) {
            const currentUser = await prisma.user.findFirst({ where: { id: userId } });
            if (currentUser) {
                req.logged = {
                    id: currentUser.id,
                    type: currentUser.type,
                    email: currentUser.email,
                    name: currentUser.name
                };
            }
        }
    } catch (_e) {
        // Ignora erros de token em consulta pública opcional
    }

    return next();
};

