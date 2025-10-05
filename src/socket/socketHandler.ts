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

// Helper function to sync user from Clerk to database
async function syncUserFromClerk(clerkId: string): Promise<any> {
    try {
        // Check if user exists
        let user = await prisma.user.findUnique({
            where: { clerkId }
        });

        if (!user) {
            console.log(`🆕 New user detected: ${clerkId}, needs sync from Clerk...`);
            // User doesn't exist - they need to be synced via the auth/sync endpoint first
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
                // Verify user exists in database
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

                // Send current online users count to all clients
                io.emit('online-users-count', { count: userSockets.size });

                // Send confirmation to the user
                socket.emit('connection-confirmed', {
                    userId,
                    socketId: socket.id,
                    onlineCount: userSockets.size
                });

                console.log(`👥 Total online users: ${userSockets.size}`);

            } catch (error) {
                console.error('❌ Error handling user-online:', error);
                socket.emit('error', { message: 'Failed to connect user' });
            }
        });

        // Handle typing indicators
        socket.on('typing', (data: TypingData) => {
            if (!data.toUserId || !data.fromUserId) {
                console.log('❌ Invalid typing data:', data);
                return;
            }

            console.log(`⌨️ ${data.username || data.fromUserId} is typing to ${data.toUserId}`);
            const targetSocketId = userSockets.get(data.toUserId);

            if (targetSocketId) {
                socket.to(targetSocketId).emit('user-typing', {
                    fromUserId: data.fromUserId,
                    username: data.username || 'Unknown User',
                });
                console.log(`📤 Typing indicator sent to socket ${targetSocketId}`);
            } else {
                console.log(`📴 Target user ${data.toUserId} not online`);
            }
        });

        // Handle stop typing
        socket.on('stop-typing', (data: StopTypingData) => {
            if (!data.toUserId || !data.fromUserId) {
                console.log('❌ Invalid stop-typing data:', data);
                return;
            }

            console.log(`⌨️ User ${data.fromUserId} stopped typing to ${data.toUserId}`);
            const targetSocketId = userSockets.get(data.toUserId);

            if (targetSocketId) {
                socket.to(targetSocketId).emit('user-stop-typing', {
                    fromUserId: data.fromUserId,
                });
                console.log(`📤 Stop typing indicator sent to socket ${targetSocketId}`);
            }
        });

        // Handle direct message sending (optional - messages are also sent via HTTP API)
        socket.on('send-message', async (data: { 
            receiverId: string; 
            content: string;
            messageId?: string;
        }) => {
            const senderId = socketUsers.get(socket.id);
            
            if (!senderId) {
                console.log('❌ Sender not identified');
                socket.emit('error', { message: 'Not authenticated' });
                return;
            }

            console.log(`📨 Direct message from ${senderId} to ${data.receiverId}`);
            
            const receiverSocketId = userSockets.get(data.receiverId);
            
            if (receiverSocketId) {
                socket.to(receiverSocketId).emit('new-message', {
                    ...data,
                    senderId,
                    timestamp: new Date().toISOString()
                });
                console.log(`📤 Message delivered to ${data.receiverId}`);
            } else {
                console.log(`📴 Receiver ${data.receiverId} not online - message will be stored via API`);
            }

            // Confirm to sender
            socket.emit('message-delivered', {
                messageId: data.messageId,
                delivered: !!receiverSocketId
            });
        });

        // Handle read receipts
        socket.on('message-read', (data: { messageId: string; senderId: string }) => {
            const senderSocketId = userSockets.get(data.senderId);
            
            if (senderSocketId) {
                socket.to(senderSocketId).emit('message-read-receipt', {
                    messageId: data.messageId,
                    readAt: new Date().toISOString()
                });
                console.log(`✅ Read receipt sent for message ${data.messageId}`);
            }
        });

        // Handle connection errors
        socket.on('error', (error) => {
            console.error('❌ Socket error:', error);
        });

        socket.on('connect_error', (error) => {
            console.error('❌ Connection error:', error);
        });

        // Handle disconnect
        socket.on('disconnect', (reason) => {
            const userId = socketUsers.get(socket.id);
            console.log(`📴 Socket disconnected: ${socket.id}, reason: ${reason}`);

            if (userId) {
                // Clean up mappings
                userSockets.delete(userId);
                socketUsers.delete(socket.id);

                // Notify other users about offline status
                socket.broadcast.emit('user-offline-status', { userId });

                // Send updated online users count
                io.emit('online-users-count', { count: userSockets.size });

                console.log(`👋 User ${userId} went offline`);
                console.log(`👥 Total online users: ${userSockets.size}`);
            } else {
                console.log(`⚠️ Disconnected socket ${socket.id} had no associated user`);
            }
        });

        // Handle ping/pong for connection health check
        socket.on('ping', () => {
            socket.emit('pong', { timestamp: Date.now() });
        });
    });

    // Store userSockets on io instance for API route access
    (io as any).userSockets = userSockets;
    (io as any).socketUsers = socketUsers;

    // Helper method to get online users list
    (io as any).getOnlineUsers = () => {
        return Array.from(userSockets.keys());
    };

    // Helper method to check if user is online
    (io as any).isUserOnline = (userId: string) => {
        return userSockets.has(userId);
    };

    // Helper method to get user socket
    (io as any).getUserSocket = (userId: string) => {
        return userSockets.get(userId);
    };

    // Helper method to emit to specific user
    (io as any).emitToUser = (userId: string, event: string, data: any) => {
        const socketId = userSockets.get(userId);
        if (socketId) {
            io.to(socketId).emit(event, data);
            return true;
        }
        return false;
    };

    // Periodic cleanup of stale connections (every 30 seconds)
    setInterval(() => {
        const connectedSockets = new Set(Array.from(io.sockets.sockets.keys()));
        let removedCount = 0;

        // Clean up any mappings for disconnected sockets
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

    // Log server stats every 5 minutes
    setInterval(() => {
        console.log(`📊 Socket.io Stats:
        - Connected Sockets: ${io.sockets.sockets.size}
        - Online Users: ${userSockets.size}
        - Socket Mappings: ${socketUsers.size}`);
    }, 300000);

    console.log('🚀 Socket.io server initialized with enhanced features');
    console.log('📡 Features enabled:');
    console.log('   - User online/offline status');
    console.log('   - Typing indicators');
    console.log('   - Direct messaging');
    console.log('   - Read receipts');
    console.log('   - Connection health checks');
    console.log('   - Automatic cleanup');

    return io;
}