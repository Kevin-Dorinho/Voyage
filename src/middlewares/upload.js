import multer from "multer";
import { validateImageBuffer } from "../utils/imageValidator.js";

const storage = multer.memoryStorage();

const allowedMimeTypes = [
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
    "image/jpg"
];

const upload = multer({
    storage,
    limits: {
        fileSize: 5 * 1024 * 1024 // 5 MB
    },
    fileFilter: (_req, file, cb) => {
        if (allowedMimeTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error("Tipo de arquivo inválido. Apenas imagens (JPEG, PNG, WebP, GIF) são permitidas."));
        }
    }
});

/**
 * Valida os primeiros bytes (magic numbers / assinaturas de cabeçalho) do buffer
 * para assegurar que é um arquivo de imagem legítimo (JPEG, PNG, WebP ou GIF).
 */
export function isValidImageBuffer(buffer) {
    if (!buffer || !Buffer.isBuffer(buffer) || buffer.length < 3) {
        return false;
    }

    // JPEG: FF D8 FF
    if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
        return true;
    }

    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (buffer.length >= 8 &&
        buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47 &&
        buffer[4] === 0x0D && buffer[5] === 0x0A && buffer[6] === 0x1A && buffer[7] === 0x0A) {
        return true;
    }

    // GIF: 47 49 46 38 ('GIF87a' ou 'GIF89a')
    if (buffer.length >= 4 &&
        buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38) {
        return true;
    }

    // WebP: 'RIFF' nos bytes 0-3 e 'WEBP' nos bytes 8-11
    if (buffer.length >= 12 &&
        buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
        buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) {
        return true;
    }

    return false;
}

/**
 * Middleware para upload de arquivo único ('file') com tratamento de erros,
 * validação de cabeçalho (magic numbers), decodificação estrutural,
 * detecção de arquivos truncados e verificação de dimensões.
 */
export function uploadSingleFile(fieldName = "file") {
    const singleUpload = upload.single(fieldName);

    return (req, res, next) => {
        singleUpload(req, res, async (err) => {
            if (err instanceof multer.MulterError) {
                if (err.code === "LIMIT_FILE_SIZE") {
                    return res.status(400).json({
                        error: "Arquivo muito grande. O limite máximo permitido é 5MB."
                    });
                }
                return res.status(400).json({
                    error: `Erro no envio do arquivo: ${err.message}`
                });
            } else if (err) {
                return res.status(400).json({
                    error: err.message
                });
            }

            // Validação profunda do conteúdo dos bytes quando um arquivo foi anexado
            if (req.file) {
                if (!isValidImageBuffer(req.file.buffer)) {
                    return res.status(400).json({
                        error: "Conteúdo de arquivo inválido. O arquivo enviado não é uma imagem válida (JPEG, PNG, WebP, GIF)."
                    });
                }

                const decoded = await validateImageBuffer(req.file.buffer);
                if (!decoded.valid) {
                    return res.status(400).json({
                        error: `Falha na decodificação da imagem: ${decoded.error}`
                    });
                }

                req.file.imageDimensions = {
                    width: decoded.width,
                    height: decoded.height,
                    format: decoded.format
                };
            }

            next();
        });
    };
}
