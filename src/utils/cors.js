/**
 * Configuração flexível e segura de CORS.
 * Permite definir origens autorizadas via variável CORS_ORIGIN (separadas por vírgula).
 * Em ambiente de desenvolvimento ou quando não configurado, aceita qualquer origem.
 */
export function getCorsOptions() {
    const rawOrigins = process.env.CORS_ORIGIN;

    if (!rawOrigins || rawOrigins.trim() === "*") {
        return { origin: true, credentials: true };
    }

    const allowedOrigins = rawOrigins
        .split(",")
        .map(o => o.trim())
        .filter(Boolean);

    return {
        origin: (origin, callback) => {
            // Permite requisições sem origin (como mobile apps nativos, curl, postman, server-to-server)
            if (!origin) {
                return callback(null, true);
            }

            if (allowedOrigins.includes(origin)) {
                return callback(null, true);
            }

            return callback(new Error(`Origem '${origin}' não autorizada pela política de CORS.`));
        },
        credentials: true
    };
}
