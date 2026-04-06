import {IsEmail, IsString, Length} from "class-validator";


export class CreateUserDTO {
    @IsString()
    @Length(3, 20, { message: 'Tên phải từ 3 đến 20 ký tự' })
    username: string;
    @IsEmail({}, { message: 'Email không hợp lệ' })
    email: string;
    @Length(3, 20, { message: 'Mật khẩu phải từ 3 đến 20 ký tự' })
    password: string;
    retype_password: string;
    created_at: Date;
}
export class UpdateUserDTO {
    @IsString()
    @Length(3, 20, { message: 'Tên phải từ 3 đến 20 ký tự' })
    username: string;
    @IsEmail({}, { message: 'Email không hợp lệ' })
    email: string;
    updated_at: Date;
}

