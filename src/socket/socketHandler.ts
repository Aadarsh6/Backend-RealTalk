import { Server } from 'socket.io';
import { Server as HttpServer} from 'http';


interface TypingData{
    toUserId: string;
    fromUserId: string;
    username: string;
}

interface stopTypingData{
    toUserId: string;
    fromUserId: string;
}

export function initializeSocket(server: HttpServer){
    const io = new Server(server,{
        cors:{
            origin: process.env.NODE_ENV === 'production'
            ? [process.env.FRONTEND_URL || ''] 
            : ['http://localhost:3000', 'http://localhost:3001'], 
            methods: ['GET', 'POST '],
            credentials: true
        },
        transports: ['websocket','polling'],
        pingTimeout: 60000,
        pingInterval: 25000,
        allowEIO3: true
    })

    //store user socket mapping

    const userSockets = new Map<string, string>();

    io.on('connection', (socket)=>{
        console.log(`user connected ${socket.id}`);
        //handle user online

        socket.on('user-online', (userId: string)=>{
            if(!userId){
                console.log('❌ Invalid userId provided');
                return;
            }
            console.log(`📱 User ${userId} going online with socket ${socket.id}`);
            
                  // Remove any existing mappings for this user
            for (const [existingUserId, existingSocketId] of userSockets.entries()) {
                if (existingUserId === userId && existingSocketId !== socket.id) {
                    userSockets.delete(existingUserId);
                    console.log(`🔄 Removed old socket mapping for user ${userId}`);
                }
            };

            userSockets.set(userId, socket.id);
            (socket as any).userId = userId;

            //notify user online status
            socket.broadcast.emit('user-online-status', {userId})

            //current online user count

            io.emit('online-user-count', {count: userSockets.size});

            console.log(`👥 Total online users: ${userSockets.size}`);
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
                console.log(`📤 Typing indicator sent to ${targetSocketId}`);
            } else {
                console.log(`❌ Target user ${data.toUserId} not found online`);
            }
        });
        
    // Handle stop typing
        socket.on('stop-typing', (data: stopTypingData) => {
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
                console.log(`📤 Stop typing indicator sent to ${targetSocketId}`);
            }
        });

        // Handle connection errors
        socket.on('error', (error) => {
            console.error('❌ Socket error:', error);
        });

        // Handle disconnect
        socket.on('disconnect', (reason) => {
            const userId = (socket as any).userId;
            console.log(`📴 User disconnected: ${socket.id}, reason: ${reason}`);
            
            if (userId) {
                userSockets.delete(userId);
                
                // Notify other users about offline status
                socket.broadcast.emit('user-offline-status', { userId });
                
                // Send updated online users count
                io.emit('online-users-count', { count: userSockets.size });
                
                console.log(`👋 User ${userId} went offline`);
                console.log(`👥 Total online users: ${userSockets.size}`);
            }
        });
    });

    // Store userSockets on io instance for API route access
    (io as any).userSockets = userSockets;

    console.log('🚀 Socket.io server initialized');
    return io;
}