import express from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { validateClerkToken } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';

const router = express.Router();

// Validation schemas
const sendMessageSchema = z.object({
    receiverId: z.string().min(1, "Receiver ID is required"),
    content: z.string()
        .min(1, "Message content is required")
        .max(1000, "Message must be less than 1000 characters")
        .transform(str => str.trim())
});

const getMessagesSchema = z.object({
    with: z.string().min(1, "User ID is required")
});

// POST /api/messages - Send a message
router.post('/', validateClerkToken, asyncHandler(async (req, res) => {
    const { userId: clerkId } = req.auth!;
    
    // Validate request body
    const validation = sendMessageSchema.safeParse(req.body);
    if (!validation.success) {
        return res.status(400).json({
            error: "Invalid request data",
            details: validation.error.errors
        });
    }
    
    const { receiverId, content } = validation.data;

    // Verify sender exists
    const sender = await prisma.user.findUnique({
        where: { clerkId }
    });
    
    if (!sender) {
        return res.status(404).json({ error: "Unauthorized sender" });
    }

    // Verify receiver exists
    const receiver = await prisma.user.findUnique({
        where: { id: receiverId }
    });
    
    if (!receiver) {
        return res.status(404).json({ error: "Receiver not found" });
    }

    // Prevent sending message to self
    if (sender.id === receiver.id) {
        return res.status(400).json({ error: "Cannot send message to yourself" });
    }

    try {
        // Create message
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

        console.log(`📨 Message created: ${message.id} from ${sender.username} to ${receiver.username}`);

        // Emit to Socket.io if available
        if (global.io && (global.io as any).userSockets) {
            const userSockets = (global.io as any).userSockets;
            const receiverSocketId = userSockets.get(receiver.clerkId);
            const senderSocketId = userSockets.get(sender.clerkId);

            // Send to receiver
            if (receiverSocketId) {
                global.io.to(receiverSocketId).emit('new-message', message);
                global.io.to(receiverSocketId).emit('message-notification', {
                    message,
                    from: sender
                });
                console.log(`📤 Message sent to receiver socket: ${receiverSocketId}`);
            } else {
                console.log(`📴 Receiver ${receiver.username} not online`);
            }

            // Send to sender (for multi-device sync)
            if (senderSocketId && senderSocketId !== receiverSocketId) {
                global.io.to(senderSocketId).emit('message-sent', message);
                console.log(`📤 Message confirmation sent to sender socket: ${senderSocketId}`);
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
    
    // Validate query parameters
    const validation = getMessagesSchema.safeParse(req.query);
    if (!validation.success) {
        return res.status(400).json({
            error: "Invalid query parameters",
            details: validation.error.errors
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
                    // Current user sends to other user
                    {
                        senderId: currentUser.id,
                        receiverId: withUserId
                    },
                    // Other user sends to current user
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

        console.log(`📥 Retrieved ${messages.length} messages for conversation between ${currentUser.username} and ${otherUser.username}`);
        res.json(messages);

    } catch (error) {
        console.error("❌ Error fetching messages:", error);
        res.status(500).json({ error: "Failed to fetch messages" });
    }
}));

export default router;