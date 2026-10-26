import { Request, Response } from 'express';

import { createPrincipal } from '../services/principal.service';

export const createPrincipalController = async (
    req: Request,
    res: Response,
): Promise<void> => {
    try {
        const { fullName, email, phone, password, branchId } = req.body;

        const principal = await createPrincipal({
            fullName,
            email,
            phone,
            password,
            branchId,
        });

        res.status(201).json({
            success: true,
            message: 'Principal created successfully',
            data: {
                id: principal._id,
                fullName: principal.fullName,
                email: principal.email,
                phone: principal.phone,
                role: principal.role,
                branchId: principal.branchId,
                isActive: principal.isActive,
                createdAt: principal.createdAt,
            },
        });
    } catch (error) {
        const message =
            error instanceof Error
                ? error.message
                : 'Failed to create principal';

        const statusCode =
            message === 'User with this email already exists' ? 409 : 400;

        res.status(statusCode).json({
            success: false,
            message,
        });
    }
};