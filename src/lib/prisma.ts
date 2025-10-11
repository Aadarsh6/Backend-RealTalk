// src/lib/prisma.ts - OPTIMIZED FOR NEON DB
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as {
    prisma: PrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? 
    new PrismaClient({
        log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
        errorFormat: 'minimal',
        // OPTIMIZATION: Connection pooling for Neon
        datasources: {
            db: {
                url: process.env.DATABASE_URL
            }
        },
    });

// CRITICAL: Use connection pooling with Neon
// Add this to your .env file:
// DATABASE_URL="postgresql://user:pass@host/db?pgbouncer=true&connection_limit=10"

if (process.env.NODE_ENV !== 'production') {
    globalForPrisma.prisma = prisma;
}

// Keep connection warm (reduces cold start latency)
setInterval(async () => {
    try {
        await prisma.$queryRaw`SELECT 1`;
    } catch (e) {
        console.error('Connection keep-alive failed:', e);
    }
}, 60000); // Every 60 seconds

process.on('beforeExit', async () => {
    await prisma.$disconnect();
});

process.on('SIGINT', async () => {
    await prisma.$disconnect();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    await prisma.$disconnect();
    process.exit(0);
});