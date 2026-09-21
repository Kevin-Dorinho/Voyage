
import jwt from 'jsonwebtoken';

const SECRET_KEY = process.env.JWT_SECRET;
if (!SECRET_KEY) {
    console.warn("AVISO DE SEGURANÇA: JWT_SECRET não configurado nas variáveis de ambiente!");
}
const JWT_SECRET = SECRET_KEY || 'voyage_default_dev_secret';

export const auth = (req, res, next) => {
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
        const logged = jwt.verify(token, JWT_SECRET);
        // Anexa as informações do usuário logado na requisição (ex: req.user.id)
        req.logged = {
            id: logged.sub,
            type: logged.type,
            email: logged.email,
            name: logged.name
        }

        // Passa para as Rotas (e consequentemente para o Service)
        return next();
    } catch (err) {
        return res.status(401).json({ error: 'Token inválido ou expirado' });
    }
};
