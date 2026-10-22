import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { LabProject } from './entities/lab-project.entity';
import { checkRepo, isValidRepo, RepoCheck } from './lab-github';

// What the owner sees of a project: everything but the token.
export type LabProjectView = Omit<LabProject, 'token'>;

export function toView(project: LabProject): LabProjectView {
  const view: Partial<LabProject> = { ...project };

  delete view.token;

  return view as LabProjectView;
}

@Injectable()
export class LabProjectsService {
  constructor(
    @InjectRepository(LabProject)
    private readonly projects: Repository<LabProject>,
  ) {}

  async list(userId: number): Promise<LabProjectView[]> {
    return (
      await this.projects.find({ where: { userId }, order: { id: 'ASC' } })
    ).map(toView);
  }

  async findOwned(id: number, userId: number): Promise<LabProject> {
    const project = await this.projects.findOne({ where: { id, userId } });

    if (!project) throw new NotFoundException('Project not found');

    return project;
  }

  // A project is saved only when the token reads the repository; the write probe decides canWrite, which runs need.
  async create(
    userId: number,
    input: { name: string; repo: string; token: string; baseBranch?: string },
  ): Promise<LabProjectView> {
    if (!isValidRepo(input.repo))
      throw new BadRequestException('Репозиторий указывается как owner/name');

    const baseBranch = input.baseBranch || 'main';
    const check = await checkRepo(input.repo, input.token, baseBranch);

    if (!check.canRead)
      throw new BadRequestException(check.problems.join('. '));

    return toView(
      await this.projects.save(
        this.projects.create({
          userId,
          name: input.name,
          repo: input.repo,
          baseBranch,
          token: input.token,
          tokenHint: input.token.slice(-4),
          checkedAt: new Date(),
          canWrite: check.canWrite,
        }),
      ),
    );
  }

  async update(
    id: number,
    userId: number,
    input: { name?: string; baseBranch?: string; token?: string },
  ): Promise<LabProjectView> {
    const project = await this.findOwned(id, userId);

    // A new token or branch is verified on the candidate values before the entity changes: one that fails is refused with the
    // reasons, and the stored token and branch stay as they were (the token is write-only, a broken one pasted over it is unrecoverable).
    if (input.baseBranch !== undefined || input.token !== undefined) {
      const baseBranch = input.baseBranch ?? project.baseBranch;
      const token = input.token ?? project.token;
      const check = await checkRepo(project.repo, token, baseBranch);

      if (!check.canRead || !check.branchFound)
        throw new BadRequestException(check.problems.join('. '));

      project.baseBranch = baseBranch;
      project.token = token;
      project.tokenHint = token.slice(-4);
      project.checkedAt = new Date();
      project.canWrite = check.canWrite;
    }

    if (input.name !== undefined) project.name = input.name;

    return toView(await this.projects.save(project));
  }

  async check(
    id: number,
    userId: number,
  ): Promise<RepoCheck & { project: LabProjectView }> {
    const project = await this.findOwned(id, userId);
    const result = await this.applyCheck(project);

    return { ...result, project: toView(await this.projects.save(project)) };
  }

  async remove(id: number, userId: number): Promise<void> {
    await this.findOwned(id, userId);
    await this.projects.delete({ id, userId });
  }

  private async applyCheck(project: LabProject): Promise<RepoCheck> {
    const result = await checkRepo(
      project.repo,
      project.token,
      project.baseBranch,
    );

    project.checkedAt = new Date();
    project.canWrite = result.canWrite;

    return result;
  }
}
