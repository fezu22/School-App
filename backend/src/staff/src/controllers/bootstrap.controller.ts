import { Request, Response } from 'express';
import {createHash, timingSafeEqual} from 'node:crypto';
import {BootstrapError, provisionBootstrapSuperAdmin} from '../services/bootstrap.service';

export const bootstrapSuperAdmin = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const configuredSecret = process.env.SUPER_ADMIN_BOOTSTRAP_SECRET;
    if (
      !configuredSecret ||
      configuredSecret.trim().length < 32 ||
      /^(unconfigured|placeholder|dummy|replace_me)/i.test(configuredSecret.trim())
    ) {
      res.status(503).json({
        success: false,
        message: 'Super Admin bootstrap is disabled',
      });
      return;
    }
    // Header only: never accept the secret in a URL, request body or frontend config.
    const suppliedSecret = req.get('X-Bootstrap-Secret');
    const digest = (value: string) => createHash('sha256').update(value).digest();
    if (!suppliedSecret || !timingSafeEqual(digest(suppliedSecret), digest(configuredSecret))) {
      res.status(403).json({success: false, message: 'Bootstrap authorization failed'});
      return;
    }
    const user = await provisionBootstrapSuperAdmin(req.body);

    res.status(201).json({
      success: true,
      message: 'Super Admin created successfully',
      user: {
        id: user._id,
        fullName: user.fullName,
        email: user.email,
        role: user.role,
        isActive: user.isActive,
      },
    });
  } catch (error) {
    res.status(error instanceof BootstrapError ? error.status : 500).json({
      success: false,
      message: error instanceof BootstrapError ? error.message : 'Failed to provision Super Admin',
    });
  }
};
