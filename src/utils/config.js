// src/utils/config.js
// Configuração centralizada para JWT e variáveis sensíveis.
// Falha ao importar se JWT_SECRET estiver ausente ou vazio,
// impedindo que o servidor inicie com segredo inseguro.

import 'dotenv/config';

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET || JWT_SECRET.trim() === '') {
    console.error(
        '\n[FATAL] JWT_SECRET não está configurada.\n' +
        'Defina JWT_SECRET no arquivo .env com um valor forte e aleatório.\n' +
        'O servidor não pode iniciar sem essa variável.\n'
    );
    process.exit(1);
}

export { JWT_SECRET };
