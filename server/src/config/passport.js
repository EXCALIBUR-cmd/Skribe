import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import config from './env.js';
import authService from '../services/auth.service.js';

export const configurePassport = () => {

  passport.use(
    new GoogleStrategy(
      {
        clientID: config.googleClientId,
        clientSecret: config.googleClientSecret,
        callbackURL: config.googleCallbackUrl
      },
      async (accessToken, refreshToken, profile, done) => {
        try {
          const email = profile.emails && profile.emails[0] ? profile.emails[0].value : null;
          const avatar = profile.photos && profile.photos[0] ? profile.photos[0].value : '';

          if (!email) {
            return done(new Error('No email address associated with this Google account'), null);
          }

          const { user, token } = await authService.handleGoogleOAuthUser({
            googleId: profile.id,
            email,
            name: profile.displayName,
            avatar
          });

          return done(null, { user, token });
        } catch (err) {
          return done(err, null);
        }
      }
    )
  );
};

export default configurePassport;
