import { IsEmail, IsOptional, IsString, Length } from 'class-validator';

export class LoginDTO {
  @IsEmail({}, { message: 'Email không hợp lệ' })
  email: string;

  @IsString()
  @Length(6, 72, { message: 'Mật khẩu phải từ 6 đến 72 ký tự' })
  password: string;
}

export class CreateUserDTO extends LoginDTO {
  @IsString()
  @Length(3, 40, { message: 'Tên phải từ 3 đến 40 ký tự' })
  username: string;

  @IsString()
  @Length(6, 72, { message: 'Mật khẩu nhập lại phải từ 6 đến 72 ký tự' })
  retype_password: string;
}

export class UpdateUserDTO {
  @IsOptional()
  @IsString()
  @Length(3, 40, { message: 'Tên phải từ 3 đến 40 ký tự' })
  username?: string;

  @IsOptional()
  @IsEmail({}, { message: 'Email không hợp lệ' })
  email?: string;
}
