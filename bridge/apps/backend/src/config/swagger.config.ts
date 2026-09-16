import { DocumentBuilder } from '@nestjs/swagger';

export const swaggerConfig = new DocumentBuilder()
  .setTitle('ntlstl')
  .setDescription('ntlstl API description')
  .setVersion('1.0')
  .addTag('auth')
  .addBearerAuth()
  .build();
