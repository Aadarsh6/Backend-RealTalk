import express from "express"

const router = express.Router()

router.post('/sync', asyncHandler(async(req, res))=>{
    const { clerkUser }= req.body
})