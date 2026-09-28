/**
 * Bateria de Testes de Integração — ETAPA 5
 * Voyage Backend: Infraestrutura, Segurança HTTP, CORS e Rate Limiting
 *
 * Executar com: node testes/etapa5.test.js
 */

import { setupTestDatabase } from "./helpers/testDb.js";

// Inicializa banco temporário antes de qualquer import do Prisma
const testDb = await setupTestDatabase();

import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";

const { default: prisma } = await import("../src/utils/prisma.js");
const { securityHeaders } = await import("../src/middlewares/security.js");
const { getCorsOptions } = await import("../src/utils/cors.js");
const { default: userRouter } = await import("../src/routes/user.js");

const PORT = 4448;
const BASE_URL = `http://127.0.0.1:${PORT}`;

let server;
let passed = 0;
let failed = 0;
let skipped = 0;

function assert(condition, message) {
    if (!condition) {
        console.error(`  ❌ FALHA: ${message}`);
        failed++;
        return false;
    }
    console.log(`  ✅ ${message}`);
    passed++;
    return true;
}

async function run() {
    console.log("🧪 Iniciando testes de infraestrutura e produção da Etapa 5...\n");

    const app = express();
    app.use(securityHeaders);
    app.use(cors(getCorsOptions()));
    app.use(express.json());
    app.use("/user", userRouter);

    server = app.listen(PORT);

    try {
        // =========================================================================
        // SEÇÃO 1: Cabeçalhos HTTP Defensivos
        // =========================================================================
        console.log("📋 SEÇÃO 1: Cabeçalhos HTTP Defensivos");

        {
            const res = await fetch(`${BASE_URL}/user`);
            const headers = res.headers;

            assert(headers.get("x-content-type-options") === "nosniff", "1.1 Header X-Content-Type-Options: nosniff presente");
            assert(headers.get("x-frame-options") === "DENY", "1.2 Header X-Frame-Options: DENY presente (anti-clickjacking)");
            assert(headers.get("x-xss-protection") === "1; mode=block", "1.3 Header X-XSS-Protection presente");
            assert(headers.get("referrer-policy") === "strict-origin-when-cross-origin", "1.4 Header Referrer-Policy presente");
        }

        // =========================================================================
        // SEÇÃO 2: Política de CORS
        // =========================================================================
        console.log("\n📋 SEÇÃO 2: Política de CORS");

        // 2.1 Requisição de navegador com Origin
        {
            const res = await fetch(`${BASE_URL}/user`, {
                headers: { Origin: "http://localhost:5173" }
            });
            assert(res.status !== 500, "2.1 Requisição com Origin processada normalmente pelo CORS");
        }

        // 2.2 Teste de whitelist estrita de CORS com app isolado
        {
            process.env.CORS_ORIGIN = "https://app-autorizado.com";
            const corsApp = express();
            corsApp.use(cors(getCorsOptions()));
            corsApp.get("/ping", (_req, res) => res.json({ ok: true }));
            const testCorsServer = corsApp.listen(4449);

            try {
                // Origem permitida
                const resAllowed = await fetch("http://127.0.0.1:4449/ping", {
                    headers: { Origin: "https://app-autorizado.com" }
                });
                assert(resAllowed.status === 200, "2.2 Origem autorizada no CORS_ORIGIN é aceita (200)");

                // Origem proibida
                const resDenied = await fetch("http://127.0.0.1:4449/ping", {
                    headers: { Origin: "https://site-malicioso.com" }
                });
                assert(resDenied.status === 500, "2.3 Origem não listada no CORS_ORIGIN é rejeitada pelo CORS");
            } finally {
                testCorsServer.close();
                delete process.env.CORS_ORIGIN;
            }
        }

        // =========================================================================
        // SEÇÃO 3: Rate Limiting
        // =========================================================================
        console.log("\n📋 SEÇÃO 3: Rate Limiting");

        // Simula limitador estrito para validar disparo do status 429
        {
            const rateLimitApp = express();
            const strictLimiter = rateLimit({
                windowMs: 60 * 1000,
                limit: 3, // máximo 3 requisições
                message: { error: "Muitas tentativas. Limite atingido." }
            });
            rateLimitApp.post("/login-test", strictLimiter, (_req, res) => res.json({ success: true }));
            const testRateLimitServer = rateLimitApp.listen(4450);

            try {
                // 3 requisições aceitas
                const r1 = await fetch("http://127.0.0.1:4450/login-test", { method: "POST" });
                const r2 = await fetch("http://127.0.0.1:4450/login-test", { method: "POST" });
                const r3 = await fetch("http://127.0.0.1:4450/login-test", { method: "POST" });
                assert(r1.status === 200 && r2.status === 200 && r3.status === 200, "3.1 Primeiras 3 requisições permitidas");

                // 4ª requisição bloqueada
                const r4 = await fetch("http://127.0.0.1:4450/login-test", { method: "POST" });
                const d4 = await r4.json();
                assert(r4.status === 429, "3.2 4ª requisição bloqueada com 429 Too Many Requests");
                assert(d4.error && d4.error.includes("Muitas tentativas"), "3.3 Mensagem amigável de limite de requisições excedido");
            } finally {
                testRateLimitServer.close();
            }
        }

        // =========================================================================
        // SEÇÃO 4: Integridade e Validação Rígida de User.type
        // =========================================================================
        console.log("\n📋 SEÇÃO 4: Integridade e Validação Rígida de User.type");

        // 4.1 Cadastro com tipo não permitido
        {
            const res = await fetch(`${BASE_URL}/user`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    name: "Hacker User",
                    email: "hacker@test.com",
                    password: "Senha123!Forte",
                    type: "superadmin"
                })
            });
            assert(res.status === 400, "4.1 Tipo não permitido (superadmin) rejeitado com 400");
        }

        // 4.2 Cadastro como admin no endpoint público
        {
            const res = await fetch(`${BASE_URL}/user`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    name: "Tentativa Admin",
                    email: "fakeadmin@test.com",
                    password: "Senha123!Forte",
                    type: "admin"
                })
            });
            assert(res.status === 400, "4.2 Tipo admin no cadastro público rejeitado com 400");
        }

    } catch (err) {
        console.error("❌ Erro fatal na execução dos testes:", err);
    } finally {
        server.close();
        await testDb.cleanup(prisma);
        console.log("\n════════════════════════════════════════════════════════════");
        console.log(`📊 RESULTADO ETAPA 5: ${passed} aprovados, ${failed} reprovados, ${skipped} pulados`);
        console.log("════════════════════════════════════════════════════════════\n");

        if (failed > 0) {
            process.exit(1);
        }
    }
}

run();
