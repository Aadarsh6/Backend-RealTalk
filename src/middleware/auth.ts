import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

// Extend Express Request type
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

// Simple auth middleware for development
export const validateClerkToken = async (
    req: Request, 
    res: Response, 
    next: NextFunction
) => {
    try {
        const authHeader = req.headers.authorization;
        
        if (!authHeader) {
            return res.status(401).json({ error: 'No authorization header provided' });
        }

        const token = authHeader.startsWith('Bearer ') 
            ? authHeader.slice(7) 
            : authHeader;

        if (!token) {
            return res.status(401).json({ error: 'No token provided' });
        }

        try {
            // Simple token validation (decode without verification for development)
            const decoded = jwt.decode(token) as any;
            
            if (!decoded || !decoded.sub) {
                return res.status(401).json({ error: 'Invalid token format' });
            }

            // Set user info on request
            req.auth = {
                userId: decoded.sub,
                sessionId: decoded.sid
            };

            console.log(`✅ Authenticated user: ${decoded.sub}`);
            next();

        } catch (jwtError) {
            console.error('❌ JWT validation error:', jwtError);
            return res.status(401).json({ error: 'Invalid token' });
        }

    } catch (error) {
        console.error('❌ Auth middleware error:', error);
        return res.status(500).json({ error: 'Authentication error' });
    }
};