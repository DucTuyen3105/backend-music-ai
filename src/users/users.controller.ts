import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CreateUserDTO, UpdateUserDTO } from '../DTO/user.dto';
import { UsersService } from './users.service';

@Controller('user')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('')
  public async getUsers(
    @Query('limit') limit = 20,
    @Query('page') page = 1,
  ): Promise<any> {
    return this.usersService.getAllUsers(Number(limit), Number(page));
  }

  @Get('/info/:id')
  public async getUserInfo(@Param('id') id: string): Promise<any> {
    return this.usersService.getInfoUser(id);
  }

  @Post('')
  public async createUser(@Body() requestBody: CreateUserDTO): Promise<any> {
    return this.usersService.createUser(requestBody);
  }

  @Patch('/:id')
  public async updateUser(
    @Param('id') id: string,
    @Body() requestBody: UpdateUserDTO,
  ): Promise<any> {
    return this.usersService.updateUser(id, requestBody);
  }

  @Delete('/:id')
  public async deleteUser(@Param('id') id: string): Promise<any> {
    return this.usersService.deleteUser(id);
  }
}
