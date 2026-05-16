import { Module, ValidationPipe } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { UsersModule } from './users/users.module';
import { APP_PIPE } from '@nestjs/core';
import { ChatModule } from './chat/chat.module';
import { AuthModule } from './auth/auth.module';

async function ensureMysqlDatabase(options: {
  type: string;
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
}) {
  const shouldCreate =
    process.env.DB_AUTO_CREATE_DATABASE !== 'false' &&
    ['mysql', 'mariadb'].includes(options.type);

  if (!shouldCreate || !options.database) {
    return;
  }

  const mysql = await import('mysql2/promise');
  const connection = await mysql.createConnection({
    host: options.host,
    port: options.port,
    user: options.username,
    password: options.password,
  });
  const databaseName = options.database.replace(/`/g, '``');
  await connection.query(
    `CREATE DATABASE IF NOT EXISTS \`${databaseName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  );
  await connection.end();
}

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => {
        const databaseOptions = {
          type: configService.get<string>('DB_TYPE', 'mysql'),
          host: configService.get<string>('DB_HOST', 'localhost'),
          port: Number(configService.get<string>('DB_PORT', '3306')),
          username: configService.get<string>('DB_USERNAME', 'root'),
          password: configService.get<string>('DB_PASSWORD', ''),
          database: configService.get<string>(
            'DB_DATABASE',
            'backend_music_ai',
          ),
        };

        await ensureMysqlDatabase(databaseOptions);

        return {
          ...databaseOptions,
          type: databaseOptions.type as any,
          entities: [__dirname + '/**/*.entity{.ts,.js}'],
          synchronize:
            configService.get<string>('DB_SYNCHRONIZE', 'true') === 'true',
        };
      },
    }),
    UsersModule,
    AuthModule,
    ChatModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    },
  ],
})
export class AppModule {}
