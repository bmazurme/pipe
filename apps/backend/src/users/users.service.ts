import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { CreateUserDto } from './dto/create-user.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { User } from './entities/user.entity';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  async create(createUserDto: CreateUserDto): Promise<User> {
    const { email } = createUserDto;
    const existingUser = await this.userRepository.findOne({
      where: { email },
    });

    if (existingUser) {
      throw new BadRequestException(`User with email ${email} already exists`);
    }

    return this.userRepository.save(createUserDto);
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.userRepository.findOne({ where: { email } });
  }

  async findById(id: number): Promise<User | null> {
    return this.userRepository.findOne({ where: { id } });
  }

  async update(
    id: number,
    updateFields: Partial<User>,
  ): Promise<UserResponseDto> {
    const user = await this.userRepository.findOneOrFail({ where: { id } });
    const updatedUser = await this.userRepository.save({
      ...user,
      ...updateFields,
    });

    this.logger.log(`Updated user ${id}`);

    return {
      id: updatedUser.id,
      email: updatedUser.email,
      status: updatedUser.status,
    };
  }
}
