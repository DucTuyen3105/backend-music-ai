import { Request } from 'express';
import { JwtUser } from './auth.service';

export interface AuthenticatedRequest extends Request {
  user: JwtUser;
}
