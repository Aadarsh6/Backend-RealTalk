import type { Request, Response, NextFunction } from 'express';

// Extend Express Request type to include auth property
declare global {
    namespace Express {
        interface Request {
            auth?: {
                userId: string;
                sessionId?: string;
            };
        }
    }
}

export const validateClerkToken = (req: Request, res: Response, next: NextFunction) => {
    try {
        // In a real app, you'd verify the Clerk JWT token here
        // For now, we'll simulate extracting user info from headers
        
        const authHeader = req.headers.authorization;
        
        if (!authHeader) {
            return res.status(401).json({ error: 'Authorization header required' });
        }
        
        // Extract token (assuming "Bearer <token>" format)
        const token = authHeader.split(' ')[1];
        
        if (!token) {
            return res.status(401).json({ error: 'Token required' });
        }
        
        // TODO: Replace this with actual Clerk JWT verification
        // For development, we'll extract userId from a custom header
        const userId = req.headers['x-user-id'] as string;
        
        if (!userId) {
            return res.status(401).json({ 
                error: 'User ID required in x-user-id header for development' 
            });
        }
        
        // Attach user info to request
        req.auth = {
            userId: userId
        };
        
        next();
    } catch (error) {
        console.error('❌ Auth validation error:', error);
        res.status(401).json({ error: 'Invalid token' });
    }
};