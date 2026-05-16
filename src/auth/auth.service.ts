import { Injectable, UnauthorizedException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { UsersService } from '../users/users.service';
import { User } from '../entities/user.entity';
import { CreateUserDTO } from '../DTO/user.dto';

export interface JwtUser {
  userId: string;
  username: string;
  email: string;
}

interface JwtPayload {
  sub: string;
  username: string;
  email: string;
  iat: number;
  exp: number;
}

@Injectable()
export class AuthService {
  private readonly algorithm = 'HS256';
  private readonly tokenType = 'JWT';

  constructor(private readonly usersService: UsersService) {}

  async validateUser(email: string, pass: string): Promise<User | null> {
    const user = await this.usersService.findByEmail(email);
    if (
      user &&
      (await this.usersService.comparePassword(pass, user.password_hash))
    ) {
      return user;
    }
    return null;
  }

  async register(requestBody: CreateUserDTO) {
    await this.usersService.createUser(requestBody);
    const user = await this.usersService.findByEmail(requestBody.email);
    if (!user) {
      throw new UnauthorizedException('Unable to login after register');
    }
    return this.login(user);
  }

  async login(user: User) {
    return {
      access_token: this.signAccessToken(user),
    };
  }

  verifyAccessToken(token: string): JwtUser {
    const [encodedHeader, encodedPayload, signature] = token.split('.');
    if (!encodedHeader || !encodedPayload || !signature) {
      throw new UnauthorizedException('Invalid access token');
    }

    const expectedSignature = this.sign(`${encodedHeader}.${encodedPayload}`);
    if (!this.safeCompare(signature, expectedSignature)) {
      throw new UnauthorizedException('Invalid access token');
    }

    const header = this.decodeJson<{ alg: string; typ: string }>(encodedHeader);
    if (header.alg !== this.algorithm || header.typ !== this.tokenType) {
      throw new UnauthorizedException('Unsupported access token');
    }

    const payload = this.decodeJson<JwtPayload>(encodedPayload);
    const now = Math.floor(Date.now() / 1000);
    if (!payload.sub || !payload.exp || payload.exp <= now) {
      throw new UnauthorizedException('Expired access token');
    }

    return {
      userId: payload.sub,
      username: payload.username,
      email: payload.email,
    };
  }

  private signAccessToken(user: User): string {
    const now = Math.floor(Date.now() / 1000);
    const ttlSeconds = Number(
      process.env.JWT_ACCESS_TOKEN_TTL_SECONDS ?? 60 * 60 * 24 * 180,
    );
    const header = this.encodeJson({
      alg: this.algorithm,
      typ: this.tokenType,
    });
    const payload = this.encodeJson({
      sub: user.id,
      username: user.username,
      email: user.email,
      iat: now,
      exp: now + ttlSeconds,
    });

    return `${header}.${payload}.${this.sign(`${header}.${payload}`)}`;
  }

  private getSecret(): string {
    return process.env.JWT_SECRET || 'change-this-secret-in-env';
  }

  private sign(value: string): string {
    return createHmac('sha256', this.getSecret())
      .update(value)
      .digest('base64url');
  }

  private encodeJson(value: object): string {
    return Buffer.from(JSON.stringify(value)).toString('base64url');
  }

  private decodeJson<T>(value: string): T {
    try {
      return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as T;
    } catch {
      throw new UnauthorizedException('Invalid access token');
    }
  }

  private safeCompare(left: string, right: string): boolean {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    if (leftBuffer.length !== rightBuffer.length) {
      return false;
    }
    return timingSafeEqual(leftBuffer, rightBuffer);
  }
}
