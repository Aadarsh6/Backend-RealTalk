// src/socket/socketHandler.ts - UPDATED VERSION
import { Server } from 'socket.io';
import { Server as HttpServer } from 'http';
import { prisma } from '../lib/prisma';

interface TypingData {
    toUserId: string;
    fromUserId: string;
    username: string;
}

interface StopTypingData {
    toUserId: string;
    fromUserId: string;
}

interface SendMessageData {
    receiverId: string;
    content: string;
    tempId: string; // Client-generated temporary ID
    timestamp: string;
}

// Helper function to sync user from Clerk to database
async function syncUserFromClerk(clerkId: string): Promise<any> {
    try {
        let user = await prisma.user.findUnique({
            where: { clerkId }
        });

        if (!user) {
            console.log(`🆕 New user detected: ${clerkId}, needs sync from Clerk...`);
            return null;
        }

        console.log(`✅ User found in database: ${user.username}`);
        return user;
    } catch (error) {
        console.error('❌ Error checking user:', error);
        return null;
    }
}

export function initializeSocket(server: HttpServer) {
    const io = new Server(server, {
        cors: {
            origin: process.env.NODE_ENV === 'production'
                ? [process.env.FRONTEND_URL || '']
                : ['http://localhost:3000', 'http://localhost:3001'],
            methods: ['GET', 'POST'],
            credentials: true
        },
        transports: ['websocket', 'polling'],
        pingTimeout: 60000,
        pingInterval: 25000,
        allowEIO3: true
    });

    // Store user socket mappings (clerkId -> socketId)
    const userSockets = new Map<string, string>();
    
    // Store socket user mappings (socketId -> clerkId)
    const socketUsers = new Map<string, string>();
    
    // Message queue for offline users (userId -> messages[])
    const offlineMessageQueue = new Map<string, any[]>();

    io.on('connection', (socket) => {
        console.log(`✅ Socket connected: ${socket.id}`);

        // Handle user going online
        socket.on('user-online', async (userId: string) => {
            if (!userId) {
                console.log('❌ Invalid userId provided');
                socket.emit('error', { message: 'Invalid user ID' });
                return;
            }

            try {
                const user = await syncUserFromClerk(userId);
                
                if (!user) {
                    console.log(`⚠️ User ${userId} not found in database`);
                    socket.emit('sync-required', { message: 'User needs to be synced' });
                    return;
                }

                console.log(`📱 User ${userId} (${user.username}) going online with socket ${socket.id}`);

                // Remove any existing mappings for this user (handle reconnection)
                const existingSocketId = userSockets.get(userId);
                if (existingSocketId && existingSocketId !== socket.id) {
                    socketUsers.delete(existingSocketId);
                    console.log(`🔄 Removed old socket mapping for user ${userId}`);
                }

                // Store mappings
                userSockets.set(userId, socket.id);
                socketUsers.set(socket.id, userId);

                // Notify other users about online status
                socket.broadcast.emit('user-online-status', { 
                    userId,
                    username: user.username,
                    avatar: user.avatar
                });

                // Send current online users count
                io.emit('online-users-count', { count: userSockets.size });

                // Send confirmation
                socket.emit('connection-confirmed', {
                    userId,
                    socketId: socket.id,
                    onlineCount: userSockets.size
                });

                // Deliver any queued offline messages
                const queuedMessages = offlineMessageQueue.get(userId);
                if (queuedMessages && queuedMessages.length > 0) {
                    console.log(`📬 Delivering ${queuedMessages.length} queued messages to ${userId}`);
                    queuedMessages.forEach(msg => {
                        socket.emit('new-message', msg);
                    });
                    offlineMessageQueue.delete(userId);
                }

                console.log(`👥 Total online users: ${userSockets.size}`);

            } catch (error) {
                console.error('❌ Error handling user-online:', error);
                socket.emit('error', { message: 'Failed to connect user' });
            }
        });

        // ============================================
        // SOCKET-FIRST MESSAGE SENDING
        // ============================================
        socket.on('send-message', async (data: SendMessageData) => {
            const senderId = socketUsers.get(socket.id);
            
            if (!senderId) {
                console.log('❌ Sender not identified');
                socket.emit('message-error', { 
                    tempId: data.tempId,
                    error: 'Not authenticated' 
                });
                return;
            }

            console.log(`📨 [SOCKET] Message from ${senderId} to ${data.receiverId}`);
            console.log(`📨 Content: "${data.content.substring(0, 50)}..."`);

            try {
                // Get sender and receiver from database
                const [sender, receiver] = await Promise.all([
                    prisma.user.findUnique({ where: { clerkId: senderId } }),
                    prisma.user.findUnique({ where: { id: data.receiverId } })
                ]);

                if (!sender) {
                    socket.emit('message-error', {
                        tempId: data.tempId,
                        error: 'Sender not found'
                    });
                    return;
                }

                if (!receiver) {
                    socket.emit('message-error', {
                        tempId: data.tempId,
                        error: 'Receiver not found'
                    });
                    return;
                }

                // STEP 1: Immediately emit to receiver (if online)
                const receiverSocketId = userSockets.get(receiver.clerkId);
                const isReceiverOnline = !!receiverSocketId;

                // Create the message object that will be sent
                const pendingMessage = {
                    tempId: data.tempId,
                    content: data.content,
                    createdAt: data.timestamp,
                    sender: {
                        id: sender.id,
                        clerkId: sender.clerkId,
                        username: sender.username,
                        name: sender.name,
                        avatar: sender.avatar
                    },
                    receiver: {
                        id: receiver.id,
                        clerkId: receiver.clerkId,
                        username: receiver.username,
                        name: receiver.name,
                        avatar: receiver.avatar
                    },
                    status: 'sending'
                };

                // Send to receiver IMMEDIATELY if online
                if (isReceiverOnline) {
                    io.to(receiverSocketId!).emit('new-message', pendingMessage);
                    console.log(`📤 [INSTANT] Message delivered to ${receiver.username}`);
                } else {
                    console.log(`📴 ${receiver.username} offline - queueing message`);
                    // Queue for offline user
                    if (!offlineMessageQueue.has(receiver.clerkId)) {
                        offlineMessageQueue.set(receiver.clerkId, []);
                    }
                    // We'll add the real message later
                }

                // STEP 2: Save to database in background (non-blocking)
                // Use setImmediate to ensure UI gets message first
                setImmediate(async () => {
                    try {
                        const savedMessage = await prisma.message.create({
                            data: {
                                content: data.content,
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

                        console.log(`💾 [DB] Message saved: ${savedMessage.id}`);

                        // STEP 3: Send confirmation to sender with real DB ID
                        socket.emit('message-confirmed', {
                            tempId: data.tempId,
                            message: savedMessage,
                            deliveredTo: isReceiverOnline ? receiver.clerkId : null
                        });

                        // STEP 4: Update receiver with real message (replace temp)
                        if (isReceiverOnline) {
                            io.to(receiverSocketId!).emit('message-confirmed', {
                                tempId: data.tempId,
                                message: savedMessage
                            });
                        } else {
                            // Add to offline queue with real DB data
                            const queue = offlineMessageQueue.get(receiver.clerkId) || [];
                            queue.push(savedMessage);
                            offlineMessageQueue.set(receiver.clerkId, queue);
                        }

                    } catch (dbError: any) {
                        console.error('❌ [DB] Failed to save message:', dbError);
                        
                        // Notify sender of failure
                        socket.emit('message-failed', {
                            tempId: data.tempId,
                            error: 'Failed to save message'
                        });

                        // Notify receiver to remove the optimistic message
                        if (isReceiverOnline) {
                            io.to(receiverSocketId!).emit('message-failed', {
                                tempId: data.tempId
                            });
                        }
                    }
                });

            } catch (error: any) {
                console.error('❌ Error handling send-message:', error);
                socket.emit('message-error', {
                    tempId: data.tempId,
                    error: error.message || 'Failed to send message'
                });
            }
        });

        // Handle typing indicators
        socket.on('typing', (data: TypingData) => {
            if (!data.toUserId || !data.fromUserId) {
                return;
            }

            const targetSocketId = userSockets.get(data.toUserId);
            if (targetSocketId) {
                socket.to(targetSocketId).emit('user-typing', {
                    fromUserId: data.fromUserId,
                    username: data.username || 'Unknown User',
                });
            }
        });

        // Handle stop typing
        socket.on('stop-typing', (data: StopTypingData) => {
            if (!data.toUserId || !data.fromUserId) {
                return;
            }

            const targetSocketId = userSockets.get(data.toUserId);
            if (targetSocketId) {
                socket.to(targetSocketId).emit('user-stop-typing', {
                    fromUserId: data.fromUserId,
                });
            }
        });

        // Handle read receipts
        socket.on('message-read', (data: { messageId: string; senderId: string }) => {
            const senderSocketId = userSockets.get(data.senderId);
            
            if (senderSocketId) {
                socket.to(senderSocketId).emit('message-read-receipt', {
                    messageId: data.messageId,
                    readAt: new Date().toISOString()
                });
            }
        });

        // Handle disconnect
        socket.on('disconnect', (reason) => {
            const userId = socketUsers.get(socket.id);
            console.log(`📴 Socket disconnected: ${socket.id}, reason: ${reason}`);

            if (userId) {
                userSockets.delete(userId);
                socketUsers.delete(socket.id);

                socket.broadcast.emit('user-offline-status', { userId });
                io.emit('online-users-count', { count: userSockets.size });

                console.log(`👋 User ${userId} went offline`);
                console.log(`👥 Total online users: ${userSockets.size}`);
            }
        });

        // Ping/pong for health check
        socket.on('ping', () => {
            socket.emit('pong', { timestamp: Date.now() });
        });
    });

    // Store on io instance for API route access (fallback)
    (io as any).userSockets = userSockets;
    (io as any).socketUsers = socketUsers;

    // Cleanup stale connections
    setInterval(() => {
        const connectedSockets = new Set(Array.from(io.sockets.sockets.keys()));
        let removedCount = 0;

        for (const [socketId, userId] of socketUsers.entries()) {
            if (!connectedSockets.has(socketId)) {
                socketUsers.delete(socketId);
                userSockets.delete(userId);
                removedCount++;
            }
        }

        if (removedCount > 0) {
            console.log(`🧹 Cleaned up ${removedCount} stale socket mappings`);
            io.emit('online-users-count', { count: userSockets.size });
        }
    }, 30000);

    console.log('🚀 Socket.io server initialized (SOCKET-FIRST MODE)');
    console.log('📡 Features enabled:');
    console.log('   ✅ Instant message delivery');
    console.log('   ✅ Background database persistence');
    console.log('   ✅ Offline message queue');
    console.log('   ✅ Typing indicators');
    console.log('   ✅ Read receipts');

    return io;
}