/**
 * Validador de integridade e decodificação profunda de imagens baseado em Sharp (libvips).
 * Efetivamente decodifica os pixels do arquivo para detectar imagens truncadas,
 * arquivos sem dados de pixel (ex: PNG sem IDAT) ou streams corrompidos,
 * aplicando limites rígidos de dimensões (largura e altura).
 */

import sharp from "sharp";

const DEFAULT_LIMITS = {
    minWidth: 1,
    minHeight: 1,
    maxWidth: 8000,
    maxHeight: 8000
};

export async function validateImageBuffer(buffer, options = {}) {
    const limits = { ...DEFAULT_LIMITS, ...options };

    if (!buffer || !Buffer.isBuffer(buffer)) {
        return { valid: false, error: "Buffer de imagem inválido ou ausente." };
    }

    if (buffer.length < 16) {
        return { valid: false, error: "Arquivo de imagem truncado ou muito pequeno." };
    }

    try {
        const image = sharp(buffer, { failOn: "error" });
        const metadata = await image.metadata();

        if (!metadata || !metadata.format) {
            return { valid: false, error: "Formato de arquivo não reconhecido como imagem suportada." };
        }

        const allowedFormats = ["jpeg", "png", "webp", "gif"];
        if (!allowedFormats.includes(metadata.format)) {
            return { valid: false, error: `Formato '${metadata.format}' não suportado. Use JPEG, PNG, WebP ou GIF.` };
        }

        const width = metadata.width;
        const height = metadata.height;

        if (!width || !height || isNaN(width) || isNaN(height)) {
            return { valid: false, error: "Não foi possível extrair as dimensões da imagem." };
        }

        if (width < limits.minWidth || height < limits.minHeight) {
            return {
                valid: false,
                error: `Dimensões da imagem muito pequenas (${width}x${height}). Mínimo permitido: ${limits.minWidth}x${limits.minHeight}px.`
            };
        }

        if (width > limits.maxWidth || height > limits.maxHeight) {
            return {
                valid: false,
                error: `Dimensões da imagem muito grandes (${width}x${height}). Máximo permitido: ${limits.maxWidth}x${limits.maxHeight}px.`
            };
        }

        // DECODIFICAÇÃO REAL DE PIXELS:
        // .raw().toBuffer() decodifica a matriz inteira de pixels usando libvips.
        // Se a imagem for truncada ou faltar chunks de pixel (como IDAT no PNG),
        // uma exceção é disparada e capturada no catch.
        await image.raw().toBuffer();

        return {
            valid: true,
            format: metadata.format,
            width,
            height
        };
    } catch (err) {
        return {
            valid: false,
            error: `Arquivo de imagem truncado, corrompido ou sem dados de pixels: ${err.message}`
        };
    }
}
