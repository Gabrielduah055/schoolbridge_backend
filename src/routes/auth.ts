import { Router } from 'express';
import type { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import AdminUser from '../models/AdminUser';
import { signAuthToken } from '../services/authTokenService';
import { authenticateUser } from '../middleware/authorization';

const router = Router();

const publicUser = (user: {
  _id: unknown;
  name: string;
  email: string;
  role: string;
  permissions: string[];
  schoolId: string;
}) => ({
  id: user._id?.toString(),
  name: user.name,
  email: user.email,
  role: user.role,
  permissions: user.permissions,
  schoolId: user.schoolId
});

router.post('/login', async (req: Request, res: Response) => {
  try {
    const email = req.body.email?.toString().trim().toLowerCase();
    const password = req.body.password?.toString() || '';

    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required.' });
      return;
    }

    const user = await AdminUser.findOne({ email });
    if (!user || !user.isActive) {
      res.status(401).json({ error: 'Invalid email or password.' });
      return;
    }

    const validPassword = await bcrypt.compare(password, user.passwordHash);
    if (!validPassword) {
      res.status(401).json({ error: 'Invalid email or password.' });
      return;
    }

    if (user.role !== 'headmaster') {
      res.status(403).json({ error: 'Dashboard access is only available to the registered headmaster admin.' });
      return;
    }

    user.lastLoginAt = new Date();
    await user.save();

    const token = signAuthToken({
      sub: user._id.toString(),
      name: user.name,
      email: user.email,
      role: user.role,
      permissions: user.permissions,
      schoolId: user.schoolId
    });

    res.json({ token, user: publicUser(user) });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Login failed.' });
  }
});

router.get('/me', authenticateUser, (req: Request, res: Response) => {
  res.json({ user: req.authUser });
});

router.post('/logout', authenticateUser, (_req: Request, res: Response) => {
  res.json({ success: true });
});

export default router;
