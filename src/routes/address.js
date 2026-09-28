import { Router } from "express";
import {
    createAddress,
    readAddress,
    showAddress,
    editAddress,
    deleteAddress
} from "../services/address.js";
import { auth, optionalAuth } from "../middlewares/auth.js";
import { uploadSingleFile } from "../middlewares/upload.js";

const router = Router();

// Criação de endereço requer autenticação e upload de imagem
router.post("/", auth, uploadSingleFile("file"), createAddress);

// Consultas públicas (com autorização opcional para proteção de endereços privados)
router.get("/", optionalAuth, readAddress);
router.get("/:id", optionalAuth, showAddress);

// Edição e exclusão requerem autenticação (dono ou admin)
router.put("/:id", auth, uploadSingleFile("file"), editAddress);
router.delete("/:id", auth, deleteAddress);

export default router;