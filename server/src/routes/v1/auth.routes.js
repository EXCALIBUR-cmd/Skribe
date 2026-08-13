import { Router } from 'express';
import passport from 'passport';
import authController from '../../controllers/auth.controller.js';
import { validateRegister, validateLogin } from '../../validators/auth.validator.js';
import { authenticate } from '../../middleware/auth.middleware.js';
import config from '../../config/env.js';

const router = Router();

router.post('/register', validateRegister, authController.register);

router.post('/login', validateLogin, authController.login);

router.get(
  '/google',
  passport.authenticate('google', {
    scope: ['profile', 'email'],
    session: false
  })
);

router.get(
  '/google/callback',
  passport.authenticate('google', {
    session: false,
    failureRedirect: `${config.clientUrl}/signin?error=oauth_failed`
  }),
  authController.googleCallback
);

router.get('/me', authenticate, authController.getMe);

router.post('/logout', authController.logout);

export default router;
