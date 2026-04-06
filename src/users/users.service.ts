import {HttpException, HttpStatus, Injectable} from '@nestjs/common';
import {User} from "../entities/user.entity";
import {InjectEntityManager, InjectRepository} from "@nestjs/typeorm";
import {EntityManager, Repository} from "typeorm";
import {CreateUserDTO, UpdateUserDTO} from "../DTO/user.dto";
import * as bcrypt from 'bcrypt';
@Injectable()
export class UsersService {
    constructor(
        @InjectRepository(User)
        private readonly userRepository: Repository<User>
    ) {}
    public async getAllUsers(limit : number, page : number): Promise<any> {
        const [data, total] = await this.userRepository.findAndCount({
            take: limit,
            skip: (page - 1) * limit,
            order: {created_at: 'DESC'}
        })
        const responseData = data.map(user => {
            return {
                username: user.username,
                email: user.email,
                created_at: user.created_at,
            }
        })
        return {
            responseData,
            meta: {
                totalItems: total,
                itemCount: responseData.length,
                itemsPerPage: limit,
                totalPages: Math.ceil(total / limit),
                currentPage: page,
            },
        }
    }
    public async getInfoUser(id:string):Promise<any> {
        const findUser = await this.userRepository.findOneBy({id})
        if(!findUser) throw new HttpException("User not found", HttpStatus.NOT_FOUND)
        return {
            username: findUser.username,
            email: findUser.email,
            created_at: findUser.created_at,
        }
    }
    public async createUser(requestBody:CreateUserDTO): Promise<any> {
        const {username,email, password, retype_password} = requestBody;
        if(password != retype_password){
            throw new HttpException('Passwords do not match', HttpStatus.BAD_REQUEST);
        }
        const findEmail = await this.userRepository.existsBy({email})
        if(findEmail){
            throw new HttpException('Email already exists', HttpStatus.BAD_REQUEST);
        }
        const saltOrRounds = 10;
        const hashPassword = await bcrypt.hash(password, saltOrRounds);
        const newUser = await this.userRepository.create({
            ...requestBody,
            password_hash: hashPassword,
            created_at: new Date(),
        });
        await this.userRepository.save(newUser);
        return {
            username: username,
            email: email,
            created_at: newUser.created_at,
        }
    }
    async updateUser(id:string, requestBody:UpdateUserDTO): Promise<any> {
        const user = await this.userRepository.findOneBy({id})
        if(!user) throw new HttpException("User not found", HttpStatus.NOT_FOUND)
        if(user.email === requestBody.email) {
            throw new HttpException('Email already exists', HttpStatus.BAD_REQUEST);
        }
        requestBody.updated_at = new Date();
        await this.userRepository.update(id, requestBody);
        const newUpdate =  await this.userRepository.findOneBy({id})
        return {
            username:newUpdate?.username,
            email:newUpdate?.email,
            updated_at: newUpdate?.updated_at,
        }
    }
    async deleteUser(id:string): Promise<any> {
        const user = await this.userRepository.delete({id})
        return "deleted successfully"
    }
}
