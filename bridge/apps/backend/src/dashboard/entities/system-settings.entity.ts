import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

// Settings of the whole installation (not of an account), edited by its owner from the Dashboard. One row, id 1.
@Entity({ name: 'system_settings' })
export class SystemSettings {
  @PrimaryColumn({ type: 'int', unsigned: true })
  id: number;

  // Whether the calls to GitHub go through the proxy. null = nothing chosen: GITHUB_PROXY_URL of the environment decides.
  @Column({ type: 'boolean', nullable: true })
  githubProxyEnabled: boolean | null;

  // The proxy itself (the stack's vpn-client by default); kept while it is switched off.
  @Column({ type: 'varchar', length: 500, nullable: true })
  githubProxyUrl: string | null;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;
}
