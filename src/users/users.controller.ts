import {Body, Controller, Delete, Get, Param, Patch, Post, Query} from '@nestjs/common';
import { UsersService } from './users.service';
import any = jasmine.any;
import {CreateUserDTO, UpdateUserDTO} from "../DTO/user.dto";

@Controller('user')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}
  @Get("")
  public async getUsers(@Query('limit')limit : number,@Query('page')page:number): Promise<any>{
      return await this.usersService.getAllUsers(limit, page);

  }
  @Get("/info/:id")
  public async getUserInfo(@Param("id") id:string): Promise<any>{
    return await this.usersService.getInfoUser(id)
  }
  @Post("")
  public async createUser(@Body() requestBody : CreateUserDTO): Promise<any>{
    return await this.usersService.createUser(requestBody);
  }
  @Patch("/:id")
  public async updateUser(@Param('id') id: string,@Body()requestBody : UpdateUserDTO ): Promise<any>{
    return await this.usersService.updateUser(id,requestBody);
  }
  @Delete("/:id")
  public async deleteUser(@Param('id') id: string): Promise<any>{
    return this.usersService.deleteUser(id)
  }
}
