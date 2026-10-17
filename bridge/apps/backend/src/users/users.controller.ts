import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Patch,
  UseGuards,
} from '@nestjs/common';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { DeploymentAccessService } from '../auth/deployment-access';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { MeResponseDto } from './dto/me-response.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UsersService } from './users.service';

@Controller('api/v1/users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly access: DeploymentAccessService,
  ) {}

  @UseGuards(JwtGuard)
  @Get('me')
  async getMe(
    @CurrentUser() currentUser: { id: number },
  ): Promise<MeResponseDto> {
    const user = await this.usersService.findById(currentUser.id);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // The same check OwnerGuard makes, so the frontend can hide owner-only
    // pages instead of letting them fail with 403.
    return MeResponseDto.fromUser(user, await this.access.isOwner(user.id));
  }

  @UseGuards(JwtGuard)
  @Patch(':id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateUserDto: UpdateUserDto,
    @CurrentUser() currentUser: { id: number },
  ) {
    if (id !== currentUser.id) {
      throw new ForbiddenException();
    }

    return this.usersService.update(id, updateUserDto);
  }
}
