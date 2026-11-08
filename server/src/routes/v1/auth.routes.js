import { Router } from 'express';
import authController from '../../controllers/auth.controller.js';
import { validateRegister, validateLogin } from '../../validators/auth.validator.js';
import { validatePreferences } from '../../validators/preference.validator.js';
import { authenticate, authenticateSession } from '../../middleware/auth.middleware.js';
import { loginAccountLimiter, loginAddressLimiter, registerAddressLimiter } from '../../middleware/rateLimit.middleware.js';

const router = Router();

router.post('/register', registerAddressLimiter, validateRegister, authController.register);

router.post('/login', loginAddressLimiter, loginAccountLimiter, validateLogin, authController.login);

router.get('/providers', authController.providers);

router.get('/google', authController.requireGoogle, authController.startGoogle);

router.get('/google/callback', authController.requireGoogle, authController.googleCallback);

router.get('/me', authenticateSession, authController.getMe);

router.patch('/me/preferences', authenticate, validatePreferences, authController.updatePreferences);

router.get('/me/landing', authenticate, authController.getLanding);

router.post('/logout', authController.logout);

export default router;
