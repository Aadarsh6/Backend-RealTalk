import express from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { validateClerkToken } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';

const router = express.Router();

// Validation schemas
const checkUserOnlineSchema = z.object({
    userId: z.string().min(1, "User ID is required")
});

// GET /api/users - Get all users except current user
router.get('/', validateClerkToken, asyncHandler(async (req, res) => {
    const { userId: clerkId } = req.auth!;

    console.log('=== USERS API CALLED ===');
    console.log('ClerkId from token:', clerkId);

    try {
        const users = await prisma.user.findMany({
            where: {
                NOT: { clerkId }
            },
            select: {
                id: true,
                clerkId: true,
                username: true,
                name: true,
                email: true,
                avatar: true,
                createdAt: true
            },
            orderBy: {
                createdAt: 'desc'
            }
        });

        console.log(`✅ Found ${users.length} users`);

        // Check online status for each user
        const usersWithStatus = users.map(user => {
            let isOnline = false;
            
            if (global.io && (global.io as any).userSockets) {
                const userSockets = (global.io as any).userSockets;
                isOnline = userSockets.has(user.clerkId);
            }

            return {
                ...user,
                isOnline
            };
        });

        // Sort by online status (online users first)
        const sortedUsers = usersWithStatus.sort((a, b) => {
            if (a.isOnline && !b.isOnline) return -1;
            if (!a.isOnline && b.isOnline) return 1;
            return 0;
        });

        res.json(sortedUsers);

    } catch (error) {
        console.error("❌ Error fetching users:", error);
        res.status(500).json({ error: "Server error" });
    }
}));

// GET /api/users/online?userId=... - Check if specific user is online
router.get('/online', validateClerkToken, asyncHandler(async (req, res) => {
    const { userId: clerkId } = req.auth!;
    
    // Validate query parameters
    const validation = checkUserOnlineSchema.safeParse(req.query);
    if (!validation.success) {
        return res.status(400).json({
            error: "Invalid query parameters",
            details: validation.error.errors
        });
    }
    
    const { userId: checkUserId } = validation.data;

    try {
        // Verify the user exists
        const userExists = await prisma.user.findUnique({
            where: { id: checkUserId }
        });

        if (!userExists) {
            return res.status(404).json({ error: "User not found" });
        }

        // Check online status
        let isOnline = false;
        if (global.io && (global.io as any).userSockets) {
            const userSockets = (global.io as any).userSockets;
            isOnline = userSockets.has(userExists.clerkId);
        }

        console.log(`🔍 Checking online status for user ${userExists.username}: ${isOnline ? 'Online' : 'Offline'}`);

        res.json({
            userId: checkUserId,
            clerkId: userExists.clerkId,
            username: userExists.username,
            isOnline
        });

    } catch (error) {
        console.error("❌ Error checking user online status:", error);
        res.status(500).json({ error: "Server error" });
    }
}));

// GET /api/users/:userId - Get specific user details
router.get('/:userId', validateClerkToken, asyncHandler(async (req, res) => {
    const { userId: clerkId } = req.auth!;
    const { userId } = req.params;

    if (!userId) {
        return res.status(400).json({ error: "User ID is required" });
    }

    try {
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                clerkId: true,
                username: true,
                name: true,
                email: true,
                avatar: true,
                createdAt: true
            }
        });

        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }

        // Check online status
        let isOnline = false;
        if (global.io && (global.io as any).userSockets) {
            const userSockets = (global.io as any).userSockets;
            isOnline = userSockets.has(user.clerkId);
        }

        res.json({
            ...user,
            isOnline
        });

    } catch (error) {
        console.error("❌ Error fetching user:", error);
        res.status(500).json({ error: "Server error" });
    }
}));

export default router;