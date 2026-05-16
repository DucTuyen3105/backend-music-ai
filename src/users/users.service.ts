import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { Repository } from 'typeorm';
import { CreateUserDTO, UpdateUserDTO } from '../DTO/user.dto';
import { User } from '../entities/user.entity';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  async findByEmail(email: string): Promise<User | null> {
    return this.userRepository.findOneBy({ email });
  }

  async comparePassword(plain: string, hash: string): Promise<boolean> {
    return bcrypt.compare(plain, hash);
  }

  public async getAllUsers(limit = 20, page = 1): Promise<any> {
    const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
    const safePage = Math.max(Number(page) || 1, 1);
    const [data, total] = await this.userRepository.findAndCount({
      take: safeLimit,
      skip: (safePage - 1) * safeLimit,
      order: { created_at: 'DESC' },
    });
    const responseData = data.map((user) => this.toPublicUser(user));
    return {
      responseData,
      meta: {
        totalItems: total,
        itemCount: responseData.length,
        itemsPerPage: safeLimit,
        totalPages: Math.ceil(total / safeLimit),
        currentPage: safePage,
      },
    };
  }

  public async getInfoUser(id: string): Promise<any> {
    const findUser = await this.userRepository.findOneBy({ id });
    if (!findUser) {
      throw new HttpException('User not found', HttpStatus.NOT_FOUND);
    }
    return this.toPublicUser(findUser);
  }

  public async createUser(requestBody: CreateUserDTO): Promise<any> {
    const { username, email, password, retype_password } = requestBody;
    if (password !== retype_password) {
      throw new HttpException('Passwords do not match', HttpStatus.BAD_REQUEST);
    }

    const [findEmail, findUsername] = await Promise.all([
      this.userRepository.existsBy({ email }),
      this.userRepository.existsBy({ username }),
    ]);
    if (findEmail) {
      throw new HttpException('Email already exists', HttpStatus.BAD_REQUEST);
    }
    if (findUsername) {
      throw new HttpException(
        'Username already exists',
        HttpStatus.BAD_REQUEST,
      );
    }

    const hashPassword = await bcrypt.hash(password, 10);
    const newUser = this.userRepository.create({
      username,
      email,
      password_hash: hashPassword,
    });
    const savedUser = await this.userRepository.save(newUser);
    return this.toPublicUser(savedUser);
  }

  async updateUser(id: string, requestBody: UpdateUserDTO): Promise<any> {
    const user = await this.userRepository.findOneBy({ id });
    if (!user) {
      throw new HttpException('User not found', HttpStatus.NOT_FOUND);
    }

    if (requestBody.email && requestBody.email !== user.email) {
      const emailExists = await this.userRepository.existsBy({
        email: requestBody.email,
      });
      if (emailExists) {
        throw new HttpException('Email already exists', HttpStatus.BAD_REQUEST);
      }
    }

    if (requestBody.username && requestBody.username !== user.username) {
      const usernameExists = await this.userRepository.existsBy({
        username: requestBody.username,
      });
      if (usernameExists) {
        throw new HttpException(
          'Username already exists',
          HttpStatus.BAD_REQUEST,
        );
      }
    }

    await this.userRepository.update(id, requestBody);
    const updatedUser = await this.userRepository.findOneBy({ id });
    return this.toPublicUser(updatedUser as User);
  }

  async deleteUser(id: string): Promise<any> {
    await this.userRepository.delete({ id });
    return 'deleted successfully';
  }

  private toPublicUser(user: User) {
    return {
      id: user.id,
      username: user.username,
      email: user.email,
      created_at: user.created_at,
      updated_at: user.updated_at,
    };
  }
}
