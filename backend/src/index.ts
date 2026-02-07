
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import cors from '@fastify/cors';
import fastifyJwt from '@fastify/jwt';
import dotenv from 'dotenv';
import path from 'path';
import connectDB from './db';
import authRoutes from './routes/auth';
import projectRoutes from './routes/projects';
import aiRoutes from './routes/ai';

dotenv.config();

const server = Fastify({
    logger: true,
    bodyLimit: 104857600 // 100MB
});

server.setErrorHandler((error: any, request, reply) => {
    server.log.error(error);
    reply.status(error.statusCode || 500).send({
        message: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
});

server.register(cors, {
    origin: true, // In production, Render backend URL will allow the frontend
    methods: ['GET', 'PUT', 'POST', 'DELETE', 'OPTIONS', 'PATCH'],
    credentials: true
});

server.register(fastifyStatic, {
    root: path.join(process.cwd(), 'public'),
    prefix: '/public/',
});

server.register(fastifyJwt, {
    secret: process.env.JWT_SECRET || 'supersecretkeychangedinproduction'
});

// Middleware to protect routes (usage: preValidation: [server.authenticate])
server.decorate("authenticate", async function (request: any, reply: any) {
    try {
        await request.jwtVerify();
    } catch (err) {
        reply.send(err);
    }
});

// Register Routes
server.register(authRoutes, { prefix: '/api/auth' });
server.register(projectRoutes, { prefix: '/api/projects' });
server.register(aiRoutes, { prefix: '/api/ai' });

const start = async () => {
    try {
        await connectDB();
        const port = parseInt(process.env.PORT || '4000');
        await server.listen({ port, host: '0.0.0.0' });
        console.log(`Server running on port ${port}`);
    } catch (err) {
        console.log(err)
        server.log.error(err);
        process.exit(1);
    }
};

start();
