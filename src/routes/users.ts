import express from "express"
import z from "zod"
import { asyncHandler } from "../middleware/asyncHandler";
import { prisma } from "../lib/prisma";
import { validateClerkToken } from "../middleware/auth";

const router = express.Router()

//check validation schema

const checkUserOnlineSchema = z.object({
    userId: z.string().min(1, "userId is required")
});

//get all user except currnet user

router.get("/", validateClerkToken, asyncHandler(async(req, res)=>{
    const {userId: clerkId} = req.auth!;

    console.log('=== USERS API CALLED ===');
    console.log('ClerkId from token:', clerkId);

    try {
        const users = await prisma.user.findMany({
            where: {
                NOT: {clerkId}
            },
            select:{
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

        //check online status for all user

        const userWithStatus = users.map(user => {
            let isOnline = false;

            if(global.io && (global.io as any).userSockets){
                const userSockets = (global.io as any).userSockets;
                isOnline = userSockets.has(user.clerkId)
            }
            return{
                ...user,
                isOnline
            };
        });

        //sort user by online status

        const sortedUser = userWithStatus.sort((a,b)=>{
            if(a.isOnline && !b.isOnline) return -1; //!Put a before b (online user comes first)
            if(!a.isOnline && b.isOnline) return 1;
            return 0;//!Keep their original order (from database: createdAt: 'desc')
        })

        res.json(sortedUser)
    } catch (error) {
        console.error("❌ Error fetching users:", error);
        res.status(500).json({ error: "Server error" });
    }
}));

// GET /api/users/online?userId=... - Check if specific user is online


router.get("/online",  validateClerkToken, asyncHandler(async (req, res)=>{
    const { userId: clerkId } = req.auth!;
    //query parameter
    const validation = checkUserOnlineSchema.safeParse(req.query)
    if(!validation.success){
        return res.status(400).json({
            error: "Invalid query parameters",
            details: validation.error
        });
    };

    const { userId: checkUserID } = validation.data;

    try {
        const userExists = await prisma.user.findUnique({
            where:{
                id: checkUserID
            }
        });
        if(!userExists){
            return res.status(404).json({ error: "User not found" });
        }

        //check online status of thst user

        let isOnline = false;
        if (global.io && (global.io as any).userSockets) {
            const userSockets = (global.io as any).userSockets;
            isOnline = userSockets.has(userExists.clerkId);
        }
        console.log(`🔍 Checking online status for user ${userExists.username}: ${isOnline ? 'Online' : 'Offline'}`);


        
    } catch (error) {
        console.error("❌ Error checking user online status:", error);
        res.status(500).json({ error: "Server error" });
    }
    }))
    
// GET /api/users/:userId - Get specific user details
    router.get("/:userId", validateClerkToken, asyncHandler(async(req, res)=>{
        const { userId: clerkId } = req.auth!;
        const { userId } = req.params;

        if(!userId){
            return res.status(400).json({error: "User Id is required"})
        }

        try {
            const user = await prisma.user.findUnique({
                where:{
                    id: clerkId
                },
                select:{
                    id: true,
                    clerkId: true,
                    username: true,
                    name: true,
                    email: true,
                    avatar: true,
                    createdAt: true,
                }
            });
            if(!user) return res.status(404).json({error: "USer not found"})

                //check that user online status

                let isOnline = false;
                if(global.io && (global.io as any).userSockets){
                    const userSockets = (global.io as any).userSockets
                    isOnline = userSockets.has(user.clerkId)
                }
                res.json({
                    ...user,
                    isOnline
                });
        } catch (error) {
            console.log("Error fetching user", error);
            res.status(500).json({error: "server error"});
        }
    
}))

export default router;