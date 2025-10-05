import express from 'express'
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv'
import helmet from 'helmet';
import { createServer } from 'http';

// Import routes
import authRoutes from './routes/auth';
import messagesRoutes from './routes/messages';
import usersRoutes from './routes/users';

// Import socket handler
import { initializeSocket } from './socket/socketHandler';


dotenv.config()
const app = express()
const server = createServer(app)//!server: Wraps Express app into a Node HTTP server (needed for websockets).
const PORT = process.env.PORT || 5000;


app.use(helmet({
    crossOriginEmbedderPolicy: false,
    contentSecurityPolicy: false,
}))


app.use(cors({
    origin: process.env.NODE_ENV === 'production'
    ? [process.env.FRONTEND_URL || '']
    : ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:5000'],
    credentials: true,
    methods: ['GET','POST','PUT','DELETE','OPTIONS'],
    allowedHeaders: ['Content_Type', 'Authorization']
}));

//Rate limit

const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100, //this limit each ip to 100 req per windowMs
    message: "You have reached the limit, try again in some time",
    standardHeaders: true,
    legacyHeaders: false
})

app.use('/api/', limiter);


//body parsing middleware

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true })) //!express.urlencoded() → handles form submissions (HTML forms).

app.get('/health/', (req, res)=>{
    res.status(200).json({
        status: "ok",
        message: "Chat app is running",
        time: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development'
    });
});

//api routes creation

app.use('/api/auth', authRoutes);
app.use('/api/messages', messagesRoutes);
app.use('/api/users', usersRoutes);

app.use('*', (req, res)=>{
    res.status(404).json({
        error: "No route found",
        path: req.originalUrl,
        method: req.method
    });
});

// app.use(errorHandler)

//initializing socket io

const io = initializeSocket(server)

declare global {
    var io: any;
}
global.io = io


// Start server
server.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📡 Socket.io server initialized`);
    console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`🔗 Frontend URL: ${process.env.FRONTEND_URL || 'http://localhost:3000'}`);
    console.log(`💚 Health check: http://localhost:${PORT}/health`);
});

process.on('SIGTERM', () => {
    console.log('🛑 SIGTERM received, shutting down gracefully');
    server.close(() => {
        console.log('📴 Process terminated');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('🛑 SIGINT received, shutting down gracefully');
    server.close(() => {
        console.log('📴 Process terminated');
        process.exit(0);
    });
});

export default app;