import express from "express"
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../middleware/asyncHandlers";

const router = express.Router()

router.post('/sync', asyncHandler(async(req, res)=>{
    const { clerkUser } = res.body;

    if (!clerkUser) {
        return res.status(400).json({ error: 'Clerk user data required' });
    }

    //check if user exist
    try {
        let user = await prisma.user.findUnique({
            where:{ clerkId: clerkUser.id}
        });


        //create a new user if he does not exist
        if(!user){
            user = await prisma.user.create({
                data:{
                    clerkId: clerkUser.id,
                    email: clerkUser.emailAddresses[0].emailAddress,
                    username: clerkUser.username || clerkUser.id,
                    name: clerkUser.firstName 
                        ? `${clerkUser.firstName} ${clerkUser.lastName || ''}`.trim() 
                        : null,
                    avatar: clerkUser.imageUrl,
                },
            });
            console.log('✅ User created:', user.username);
        }else{
            //update existing user
            user = await prisma.user.update({
                where: { clerkId: clerkUser.id },
                data: {
                    email: clerkUser.emailAddresses[0].emailAddress,
                    username: clerkUser.username || clerkUser.id,
                    name: clerkUser.firstName 
                        ? `${clerkUser.firstName} ${clerkUser.lastName || ''}`.trim() 
                        : null,
                    avatar: clerkUser.imageUrl,
                },
            });
            console.log('✅ User updated:', user.username);
        }
        res.json(user)
    } catch (error) {
        console.error('❌ Error syncing user:', error);
        res.status(500).json({ error: 'Failed to sync user' });
    }
}))

export default router;