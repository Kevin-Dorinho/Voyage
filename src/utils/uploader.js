import axios from "axios";

let customUploadHandler = null;

/**
 * Permite injetar um handler customizado de upload (útil para testes de integração).
 * @param {Function|null} handler - Função que recebe o arquivo e retorna uma Promise<string> com a URL.
 */
export function setCustomUploadHandler(handler) {
    customUploadHandler = handler;
}

/**
 * Realiza upload de imagem para o ImgBB com timeout e validações.
 * @param {Express.Multer.File} file - Arquivo recebido pelo multer
 * @returns {Promise<string>} URL da imagem no ImgBB
 */
export async function uploadToImgBB(file) {
    if (customUploadHandler) {
        return customUploadHandler(file);
    }

    if (!file || !file.buffer) {
        throw new Error("Nenhum arquivo fornecido para upload.");
    }

    const apiKey = process.env.IMG_BB_KEY;
    if (!apiKey) {
        throw new Error("Chave da API ImgBB (IMG_BB_KEY) não configurada no ambiente.");
    }

    try {
        const base64Image = file.buffer.toString("base64");
        const url = `https://api.imgbb.com/1/upload?key=${apiKey}`;

        const formData = new URLSearchParams();
        formData.append("image", base64Image);

        const response = await axios.post(url, formData.toString(), {
            headers: {
                "Content-Type": "application/x-www-form-urlencoded"
            },
            timeout: 15000 // 15 segundos de timeout
        });

        if (response.data && response.data.data && response.data.data.url) {
            return response.data.data.url;
        }

        throw new Error("Resposta inválida do serviço de upload.");
    } catch (error) {
        console.error("Erro ao enviar para ImgBB:", error.response?.data || error.message);
        throw new Error("Erro no upload da imagem.");
    }
}
