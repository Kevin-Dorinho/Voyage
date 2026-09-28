import rateLimit from "express-rate-limit";

const isTest = process.env.NODE_ENV === "test";

/**
 * Limitador para tentativas de login (mitigação contra força bruta).
 * 10 tentativas por janela de 15 minutos em produção.
 */
export const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: isTest ? 1000 : 10,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: {
        error: "Muitas tentativas de login a partir deste IP. Tente novamente após 15 minutos."
    }
});

/**
 * Limitador para cadastro de novos usuários (prevenção contra spam e robôs).
 * 20 cadastros por hora em produção.
 */
export const registerLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: isTest ? 1000 : 20,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: {
        error: "Limite de cadastros excedido para este IP. Tente novamente mais tarde."
    }
});

/**
 * Middleware para configurar cabeçalhos HTTP defensivos (semelhante ao Helmet básico).
 */
export function securityHeaders(_req, res, next) {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("X-XSS-Protection", "1; mode=block");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    next();
}
