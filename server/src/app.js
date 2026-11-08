import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import passport from 'passport';
import config from './config/env.js';
import { configurePassport } from './config/passport.js';
import apiRouter from './routes/index.js';
import notFoundMiddleware from './middleware/notFoundMiddleware.js';
import errorMiddleware from './middleware/errorMiddleware.js';

const app = express();

if (config.trustProxyHops > 0) app.set('trust proxy', config.trustProxyHops);
app.set('query parser', 'simple');

app.use(helmet());

app.use(compression());

app.use(
  cors({
    origin: config.allowedOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']
  })
);

app.use(morgan(config.isDev ? 'dev' : 'combined'));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

configurePassport();
app.use(passport.initialize());

app.use('/api', apiRouter);

app.use(notFoundMiddleware);

app.use(errorMiddleware);

export default app;
