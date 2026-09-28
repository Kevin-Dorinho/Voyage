import { Router } from 'express';
import {
    createCompany,
    readCompany,
    showCompany,
    editCompany,
    deleteCompany,
    favoriteCompany,
    unfavoriteCompany,
    listUserFavorites
} from '../services/company.js';
import { auth } from '../middlewares/auth.js';

const router = Router();

// Favoritos do usuário logado (declarado antes de /:id para não ser capturado como param)
router.get('/favorites', auth, listUserFavorites);

// Criação, edição e exclusão de empresas
router.post('/', auth, createCompany);
router.put('/:id', auth, editCompany);
router.delete('/:id', auth, deleteCompany);

// Ações de favoritar e desfavoritar empresa
router.post('/:id/favorite', auth, favoriteCompany);
router.delete('/:id/favorite', auth, unfavoriteCompany);

// Consultas públicas
router.get('/', readCompany);
router.get('/:id', showCompany);

export default router;