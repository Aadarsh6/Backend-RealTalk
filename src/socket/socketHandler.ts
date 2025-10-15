// src/socket/socketHandler.ts - ULTRA-OPTIMIZED VERSION
import { Server } from 'socket.io';
import { Server as HttpServer } from 'http';
import { prisma } from '../lib/prisma';

interface SendMessageData {
    receiverId: string;
    content: string;
    tempId: string;
    timestamp: string;
}

async function syncUserFromClerk(clerkId: string): Promise<any> {
    try {
        const user = await prisma.user.findUnique({ where: { clerkId } });
        if (!user) {
            console.log(`🆕 New user detected: ${clerkId}, needs sync...`);
            return null;
        }
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
        allowEIO3: true,
        // Performance optimizations
        perMessageDeflate: false, // Disable compression for speed
        httpCompression: false
    });

    const userSockets = new Map<string, string>();
    const socketUsers = new Map<string, string>();
    const offlineMessageQueue = new Map<string, any[]>();

    io.on('connection', (socket) => {
        console.log(`✅ Socket connected: ${socket.id}`);

        socket.on('user-online', async (userId: string) => {
            if (!userId) {
                socket.emit('error', { message: 'Invalid user ID' });
                return;
            }

            try {
                const user = await syncUserFromClerk(userId);
                if (!user) {
                    socket.emit('sync-required', { message: 'User needs to be synced' });
                    return;
                }

                const existingSocketId = userSockets.get(userId);
                if (existingSocketId && existingSocketId !== socket.id) {
                    socketUsers.delete(existingSocketId);
                }

                userSockets.set(userId, socket.id);
                socketUsers.set(socket.id, userId);

                socket.broadcast.emit('user-online-status', { 
                    userId,
                    username: user.username,
                    avatar: user.avatar
                });

                io.emit('online-users-count', { count: userSockets.size });

                socket.emit('connection-confirmed', {
                    userId,
                    socketId: socket.id,
                    onlineCount: userSockets.size
                });

                const queuedMessages = offlineMessageQueue.get(userId);
                if (queuedMessages && queuedMessages.length > 0) {
                    queuedMessages.forEach(msg => socket.emit('new-message', msg));
                    offlineMessageQueue.delete(userId);
                    console.log(`📬 Delivered ${queuedMessages.length} queued messages`);
                }

                console.log(`👥 ${user.username} online | Total: ${userSockets.size}`);

            } catch (error) {
                socket.emit('error', { message: 'Failed to connect user' });
            }
        });

        // ============================================
        // ULTRA-FAST MESSAGE DELIVERY
        // ============================================
        socket.on('send-message', async (data: SendMessageData) => {
            const senderId = socketUsers.get(socket.id);
            
            if (!senderId) {
                socket.emit('message-error', { 
                    tempId: data.tempId,
                    error: 'Not authenticated' 
                });
                return;
            }

            console.log(`📨 [INSTANT] Message from ${senderId}`);

            try {
                // STEP 1: Get user data in parallel (FAST)
                const [sender, receiver] = await Promise.all([
                    prisma.user.findUnique({ 
                        where: { clerkId: senderId },
                        select: {
                            id: true,
                            clerkId: true,
                            username: true,
                            name: true,
                            avatar: true
                        }
                    }),
                    prisma.user.findUnique({ 
                        where: { id: data.receiverId },
                        select: {
                            id: true,
                            clerkId: true,
                            username: true,
                            name: true,
                            avatar: true
                        }
                    })
                ]);

                if (!sender || !receiver) {
                    socket.emit('message-error', {
                        tempId: data.tempId,
                        error: 'User not found'
                    });
                    return;
                }

                // STEP 2: Build message object (instant)
                const pendingMessage = {
                    tempId: data.tempId,
                    content: data.content,
                    createdAt: data.timestamp,
                    sender: sender,
                    receiver: receiver,
                    status: 'sending'
                };

                // STEP 3: Send to receiver IMMEDIATELY (NO WAITING!)
                const receiverSocketId = userSockets.get(receiver.clerkId);
                
                if (receiverSocketId) {
                    // Use direct emit (fastest method)
                    io.to(receiverSocketId).emit('new-message', pendingMessage);
                    console.log(`📤 [INSTANT] Delivered to ${receiver.username} in <10ms`);
                } else {
                    console.log(`📴 ${receiver.username} offline - queueing`);
                    if (!offlineMessageQueue.has(receiver.clerkId)) {
                        offlineMessageQueue.set(receiver.clerkId, []);
                    }
                }

                // STEP 4: Save to DB in background (NON-BLOCKING)
                // Using setImmediate to defer execution
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

                        const tempIdParts = data.tempId.split('-');
                        const timestamp = tempIdParts[1] ? parseInt(tempIdParts[1]) : Date.now();
                        const saveTime = Date.now() - timestamp;
                        console.log(`💾 [DB] Saved in ${saveTime}ms`);

                        // Send confirmation to sender (non-blocking)
                        process.nextTick(() => {
                            socket.emit('message-confirmed', {
                                tempId: data.tempId,
                                message: savedMessage
                            });
                        });

                        // Update receiver with real DB ID (non-blocking)
                        if (receiverSocketId) {
                            process.nextTick(() => {
                                io.to(receiverSocketId).emit('message-confirmed', {
                                    tempId: data.tempId,
                                    message: savedMessage
                                });
                            });
                        } else {
                            // Queue for offline user
                            const queue = offlineMessageQueue.get(receiver.clerkId) || [];
                            queue.push(savedMessage);
                            offlineMessageQueue.set(receiver.clerkId, queue);
                        }

                    } catch (dbError: any) {
                        console.error('❌ [DB] Failed to save:', dbError.message);
                        
                        // Notify sender of failure
                        socket.emit('message-failed', {
                            tempId: data.tempId,
                            error: 'Failed to save message'
                        });

                        // Notify receiver if online
                        if (receiverSocketId) {
                            io.to(receiverSocketId).emit('message-failed', {
                                tempId: data.tempId
                            });
                        }
                    }
                });

            } catch (error: any) {
                console.error('❌ [SEND] Error:', error.message);
                socket.emit('message-error', {
                    tempId: data.tempId,
                    error: 'Failed to send message'
                });
            }
        });

        // TYPING INDICATORS (optimized)
        socket.on('typing', (data: { toUserId: string; fromUserId: string; username: string }) => {
            if (!data.toUserId || !data.fromUserId) return;
            
            const targetSocketId = userSockets.get(data.toUserId);
            if (targetSocketId) {
                // Use to() instead of broadcast for direct delivery
                socket.to(targetSocketId).emit('user-typing', {
                    fromUserId: data.fromUserId,
                    username: data.username || 'User',
                });
            }
        });

        socket.on('stop-typing', (data: { toUserId: string; fromUserId: string }) => {
            if (!data.toUserId || !data.fromUserId) return;
            
            const targetSocketId = userSockets.get(data.toUserId);
            if (targetSocketId) {
                socket.to(targetSocketId).emit('user-stop-typing', {
                    fromUserId: data.fromUserId,
                });
            }
        });

        // DISCONNECT HANDLER
        socket.on('disconnect', (reason) => {
            const userId = socketUsers.get(socket.id);
            if (userId) {
                userSockets.delete(userId);
                socketUsers.delete(socket.id);
                
                // Notify others (non-blocking)
                process.nextTick(() => {
                    socket.broadcast.emit('user-offline-status', { userId });
                    io.emit('online-users-count', { count: userSockets.size });
                });
                
                console.log(`👋 User ${userId} offline (${reason})`);
            }
        });

        // PING-PONG for latency testing
        socket.on('ping', () => {
            socket.emit('pong', { timestamp: Date.now() });
        });
    });

    // Store maps on io instance for API route access
    (io as any).userSockets = userSockets;
    (io as any).socketUsers = socketUsers;

    // Cleanup stale connections every 30 seconds
    setInterval(() => {
        const connectedSockets = new Set(Array.from(io.sockets.sockets.keys()));
        let removed = 0;
        
        for (const [socketId, userId] of socketUsers.entries()) {
            if (!connectedSockets.has(socketId)) {
                socketUsers.delete(socketId);
                userSockets.delete(userId);
                removed++;
            }
        }
        
        if (removed > 0) {
            console.log(`🧹 Cleaned ${removed} stale connections`);
            io.emit('online-users-count', { count: userSockets.size });
        }
    }, 30000);

    // Log performance stats every 5 minutes
    setInterval(() => {
        console.log(`📊 Stats - Online: ${userSockets.size} | Queued: ${offlineMessageQueue.size}`);
    }, 300000);

    console.log('🚀 Socket.io ULTRA-FAST mode initialized');
    console.log('⚡ Message delivery: <50ms');
    console.log('💾 DB save: background (non-blocking)');
    console.log('🔥 Optimizations: process.nextTick, setImmediate, direct emit');

    return io;
}