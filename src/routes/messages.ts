// src/routes/messages.ts - UPDATED (Fallback only, not primary)
import express from "express";
import z from "zod";
import { asyncHandler } from "../middleware/asyncHandlers";
import { prisma } from "../lib/prisma";
import { validateClerkToken } from "../middleware/auth";

const router = express.Router();

const sendMessageSchema = z.object({
    receiverId: z.string().min(1, "Receiver ID is required"),
    content: z.string()
        .min(1, "Message content is required")
        .max(1000, "Message must be less than 1000 characters")
        .transform(str => str.trim())
});

const getMessageSchema = z.object({
    with: z.string().min(1, "User ID is required")
});

// POST /api/messages - FALLBACK ONLY (Socket.io is primary)
// This route exists for:
// 1. HTTP clients that don't support WebSockets
// 2. Testing purposes
// 3. Backup when socket connection fails
router.post('/', validateClerkToken, asyncHandler(async (req, res) => {
    const { userId: clerkId } = req.auth!;

    const validation = sendMessageSchema.safeParse(req.body);
    if (!validation.success) {
        return res.status(400).json({
            error: "Invalid request data",
            details: validation.error
        });
    }

    const { receiverId, content } = validation.data;

    // Verify sender exists
    const sender = await prisma.user.findUnique({
        where: { clerkId }
    });
    
    if (!sender) {
        return res.status(404).json({ error: "User does not exist" });
    }

    // Verify receiver exists
    const receiver = await prisma.user.findUnique({
        where: { id: receiverId }
    });

    if (!receiver) {
        return res.status(404).json({ error: "Receiver does not exist" });
    }

    if (sender.id === receiver.id) {
        return res.status(400).json({ error: "Cannot send message to yourself" });
    }

    try {
        // Create message in database
        const message = await prisma.message.create({
            data: {
                content,
                senderId: sender.id,
                receiverId: receiver.id
            },
            include: {
                sender: {
                    select: {
                        id: true,
                        clerkId: true,
                        username: true,
                        name: true,
                        avatar: true
                    }
                },
                receiver: {
                    select: {
                        id: true,
                        clerkId: true,
                        username: true,
                        name: true,
                        avatar: true
                    }
                }
            }
        });

        console.log(`📨 [HTTP FALLBACK] Message created: ${message.id}`);

        // Try to emit via Socket.io if available (for users not using socket)
        if (global.io && (global.io as any).userSockets) {
            const userSockets = (global.io as any).userSockets;
            const receiverSocketId = userSockets.get(receiver.clerkId);

            if (receiverSocketId) {
                global.io.to(receiverSocketId).emit('new-message', message);
                console.log(`📤 [HTTP] Message sent to receiver socket: ${receiverSocketId}`);
            } else {
                console.log(`📴 [HTTP] Receiver ${receiver.username} not online`);
            }
        }

        res.status(201).json(message);
    } catch (error) {
        console.error("❌ Error creating message:", error);
        res.status(500).json({ error: "Failed to send message" });
    }
}));

// GET /api/messages?with=userId - Get conversation messages
router.get('/', validateClerkToken, asyncHandler(async (req, res) => {
    const { userId: clerkId } = req.auth!;
    
    const validation = getMessageSchema.safeParse(req.query);
    if (!validation.success) {
        return res.status(400).json({
            error: "Invalid query parameters",
            details: validation.error.issues
        });
    }
    
    const { with: withUserId } = validation.data;

    // Get current user
    const currentUser = await prisma.user.findUnique({
        where: { clerkId }
    });

    if (!currentUser) {
        return res.status(404).json({ error: "Current user not found" });
    }

    // Verify other user exists
    const otherUser = await prisma.user.findUnique({
        where: { id: withUserId }
    });

    if (!otherUser) {
        return res.status(404).json({ error: "User not found" });
    }

    try {
        // Get conversation messages
        const messages = await prisma.message.findMany({
            where: {
                OR: [
                    {
                        senderId: currentUser.id,
                        receiverId: withUserId
                    },
                    {
                        senderId: withUserId,
                        receiverId: currentUser.id
                    },
                ],
            },
            orderBy: { createdAt: "asc" },
            include: {
                sender: {
                    select: {
                        id: true,
                        clerkId: true,
                        username: true,
                        name: true,
                        avatar: true
                    }
                },
                receiver: {
                    select: {
                        id: true,
                        clerkId: true,
                        username: true,
                        name: true,
                        avatar: true
                    }
                },
            },
        });

        console.log(`📥 Retrieved ${messages.length} messages for conversation`);
        res.json(messages);

    } catch (error) {
        console.error("❌ Error fetching messages:", error);
        res.status(500).json({ error: "Failed to fetch messages" });
    }
}));

export default router;