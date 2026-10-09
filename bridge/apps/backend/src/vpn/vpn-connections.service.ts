import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { UpdateVpnConnectionDto } from './dto/update-vpn-connection.dto';
import { VpnConnection } from './entities/vpn-connection.entity';

@Injectable()
export class VpnConnectionsService {
  constructor(
    @InjectRepository(VpnConnection)
    private readonly repository: Repository<VpnConnection>,
  ) {}

  // The very first connection ever added becomes active automatically —
  // otherwise nothing would be active yet and every status/sync call would
  // reject with "no active connection" the moment this ships, even for an
  // account that only ever has one.
  async create(
    name: string,
    panelUrl: string,
    panelApiToken: string,
    serverAddress: string,
  ): Promise<VpnConnection> {
    const isFirst = (await this.repository.count()) === 0;

    return this.repository.save(
      this.repository.create({
        name,
        panelUrl,
        panelApiToken,
        serverAddress,
        isActive: isFirst,
      }),
    );
  }

  async findAll(): Promise<VpnConnection[]> {
    return this.repository.find({ order: { id: 'ASC' } });
  }

  // panelUrl/panelApiToken are never read back to the frontend (see
  // VpnConnectionResponseDto), so an edit can't show the current value to
  // confirm before overwriting it — a field left out of `dto` entirely
  // (undefined, not an empty string) leaves that column untouched, same
  // convention as SecretsService.update.
  async update(
    id: number,
    dto: UpdateVpnConnectionDto,
  ): Promise<VpnConnection> {
    const connection = await this.findOne(id);

    if (dto.name !== undefined) connection.name = dto.name;
    if (dto.panelUrl !== undefined) connection.panelUrl = dto.panelUrl;
    if (dto.panelApiToken !== undefined)
      connection.panelApiToken = dto.panelApiToken;
    if (dto.serverAddress !== undefined)
      connection.serverAddress = dto.serverAddress;

    return this.repository.save(connection);
  }

  async findOne(id: number): Promise<VpnConnection> {
    const connection = await this.repository.findOneBy({ id });

    if (!connection) {
      throw new NotFoundException('VPN connection not found');
    }

    return connection;
  }

  async getActive(): Promise<VpnConnection> {
    const active = await this.repository.findOneBy({ isActive: true });

    if (!active) {
      throw new InternalServerErrorException(
        'No active VPN connection is configured — add one and select it first',
      );
    }

    return active;
  }

  // Exactly one row is ever active — query builder, not a plain
  // repository.update({}, ...), since TypeORM refuses an update with empty
  // criteria (a deliberate guard against accidentally touching every row).
  async activate(id: number): Promise<void> {
    await this.findOne(id);

    await this.repository.manager.transaction(async (manager) => {
      await manager
        .createQueryBuilder()
        .update(VpnConnection)
        .set({ isActive: false })
        .where('"isActive" = true')
        .execute();

      await manager
        .createQueryBuilder()
        .update(VpnConnection)
        .set({ isActive: true })
        .where('id = :id', { id })
        .execute();
    });
  }

  async remove(id: number): Promise<void> {
    await this.repository.delete(id);
  }
}
