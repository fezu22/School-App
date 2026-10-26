import { Request, Response } from 'express';
import { generateAccessToken } from '../services/jwt.service';
import { authenticateUser, createUser } from '../services/auth.service';
import { registerSession } from '../services/session.service';
import User from '../models/user';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import Session from '../models/session';

export const register = async (req: Request, res: Response): Promise<void> => {
  try {
    const { fullName, email, phone, password, branchId} = req.body;

    if (!fullName || !email || !password) {
      res.status(400).json({
        success: false,
        message: 'Full name, email, password and branch are required'
      });
      return;
    }

    const user = await createUser({
      fullName,
      email,
      phone,
      password,
      role: 'student',
      branchId,
    });

    res.status(201).json({
      success: true,
      message: 'User created successfully',
      user: {
        id: user._id,
        fullName: user.fullName,
        email: user.email,
        phone: user.phone,
        role: user.role,
        branchId: user.branchId,
        isActive: user.isActive,
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Registration failed';

    res.status(400).json({
      success: false,
      message,
    });
  }
};

export const getCurrentUser = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: 'Unauthorized',
      });
      return;
    }

    const user = await User.findById(req.user.userId).select('-password');

    if (!user) {
      res.status(404).json({
        success: false,
        message: 'User not found',
      });
      return;
    }

    res.status(200).json({
      success: true,
      user,
    });
  } catch {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch current user',
    });
  }
};

export const login = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({
        success: false,
        message: 'Email and password are required',
      });
      return;
    }

    const user = await authenticateUser(email, password);
    const accessToken = generateAccessToken(user._id.toString(), user.role);

    await registerSession(user._id.toString(), accessToken, user.role);

    res.status(200).json({
      success: true,
      message: 'Login successful',
      accessToken,
      user: {
        id: user._id,
        fullName: user.fullName,
        email: user.email,
        phone: user.phone,
        role: user.role,
        branchId: user.branchId,
        isActive: user.isActive,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Login failed';

    res.status(401).json({
      success: false,
      message,
    });
  }
};
export const logout = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  if (!req.user) {res.status(401).json({success:false,message:'Authentication required'});return;}
  try {
    const token=req.headers.authorization!.slice(7);
    const result=await Session.updateOne(
      {userId:req.user.userId,token,isRevoked:false},
      {$set:{isRevoked:true,revokedAt:new Date(),revokedBy:req.user.userId}},
    );
    if (!result.matchedCount) {res.status(409).json({success:false,message:'Current session is unavailable'});return;}
    res.status(200).json({success:true,message:'Signed out successfully'});
  } catch {
    res.status(500).json({success:false,message:'Sign out failed. Please retry.'});
  }
};
export const rbacTest = (
  _req: AuthenticatedRequest,
  res: Response,
): void => {
  res.status(200).json({
    success: true,
    message: 'RBAC access granted',
  });
};
