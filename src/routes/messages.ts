import express from "express";
import z from "zod";
import { asyncHandler } from "../middleware/asyncHandlers";
import { prisma } from "../lib/prisma";

const router = express.Router();

const sendMessageSchema = z.object({
    receiverId: z.string().min(1, "Receiver ID is required"),
    content: z.string()
    .min(1, "Message content is required")
    .max(100, "Message must be less than 1000 characters")
    .transform(str => str.trim())
})

//!validates query param (with=userId).
const getMessageSchema = z.object({
    with: z.string().min(1, "Message content is required")
})

router.post('/', validateClerkTOken, asyncHandler(async (req, res)=>{
    //* Clerk gives you userId → but you rename it locally as clerkId.
    const { userId: clerkId } = req.auth!; //!The ! is a non-null assertion operator in TypeScript → telling TS “trust me, this will not be null or undefined”.

    const validation = sendMessageSchema.safeParse(req.body);
    if(!validation.success){
        return res.status(404).json({
            error: "Invalid req data",
            details: validation.error
        })
    }

    const { receiverId, content } = validation.data;

    //verify sender exists
    const sender = await prisma.user.findUnique({
        where: { clerkId }
    })
    if(!sender) return res.status(404).json({ error: "user does not exist"})


    //verify receiver

    const receiver = await prisma.user.findUnique({
        where: { id: receiverId }
    })

        if(!receiver) return res.status(404).json({ error: "Receiver does not exist"})

    if(sender.id === receiver.id){
        return res.status(404).json({error: "Can not send message to your self"})
    }


    try {
        const message = await prisma.message.create({
            data:{
            content,
            senderId: sender.id,
            receiverId: receiver.id
            
        },
        include: {
            sender:{
                select:{
                    id: true,
                    clerkId: true,
                    username: true,
                    name: true,
                    avatar: true
                }
            },

            receiver:{
                select:{
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

//!This if ensures that:
//! The Socket.io server is running.
//! There are tracked user sockets available.
    if(global.io && (global.io as any).userSockets){
        const userSockets = (global.io as any).userSockets;
        const receiverSocketId = userSockets.get(receiver.clerkId);
        const senderSocketId = userSockets.get(sender.clerkId);

    }
    } catch (error) {
        
    }

}))

export default router;