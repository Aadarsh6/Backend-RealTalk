import type { Request, NextFunction, Response } from "express";

type AsyncRouteHandler = (req: Request, res: Response, next: NextFunction) => Promise<any>;

export const asyncHandler = (fn: AsyncRouteHandler) => {
    return (req: Request, res: Response, next: NextFunction) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
};

//! asyncHandler is a wrapper function for Express route handlers.

//! It takes an async function (fn) and returns a new function.

//! The new function runs fn(req, res, next) inside a Promise.resolve(...).

//! If fn throws an error or rejects, .catch(next) forwards the error to Express’ error-handling middleware.

//! This avoids writing repetitive try...catch blocks in every async route.