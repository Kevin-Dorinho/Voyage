// src/utils/sanitize.js
// Sanitização centralizada de objetos User para respostas HTTP.
// Nunca retorna password ou hash de senha ao cliente.

/**
 * Remove campos sensíveis de um objeto de usuário.
 * Retorna uma cópia limpa sem password, preservando os demais campos.
 * @param {object} user - Objeto de usuário do Prisma
 * @returns {object} Usuário sanitizado (sem password)
 */
export function sanitizeUser(user) {
    if (!user) return user;
    const { password, ...safe } = user;
    return safe;
}

/**
 * Sanitiza uma lista de usuários.
 * @param {object[]} users - Array de objetos de usuário do Prisma
 * @returns {object[]} Array de usuários sanitizados
 */
export function sanitizeUsers(users) {
    if (!Array.isArray(users)) return users;
    return users.map(sanitizeUser);
}
