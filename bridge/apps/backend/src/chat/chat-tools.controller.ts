import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Post,
  UseGuards,
} from '@nestjs/common';
import { IsObject, IsOptional, IsString, Length } from 'class-validator';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { MachineOnly } from '../auth/decorators/machine-only.decorator';
import { WorkerKeyAllowed } from '../auth/decorators/worker-key-allowed.decorator';
import { JwtOrApiKeyGuard } from '../auth/guards/jwt-or-api-key.guard';
import { ChatSystemFactsService } from './chat-system-facts.service';
import {
  CHAT_TOOL_DEFINITIONS,
  CHAT_TOOLS_PROMPT,
  type ChatToolDefinition,
  toolNames,
} from './chat-tools';

export class CallChatToolDto {
  @IsString()
  @Length(1, 64)
  name: string;

  @IsOptional()
  @IsObject()
  args?: Record<string, unknown>;
}

export class ChatToolsResponseDto {
  definitions: ChatToolDefinition[];
  prompt: string;
}

export class ChatToolResultDto {
  result: string;
}

const MAX_RESULT_CHARS = 6000;

// The worker's side of the A11 tools: it asks which tools there are, and relays the model's calls here. Worker key (or an API key) only, and only for the
// account's owner — the same snapshot the chat gets for a plain question about the system.
@Controller('api/v1/chat/tools')
@UseGuards(JwtOrApiKeyGuard)
export class ChatToolsController {
  constructor(private readonly facts: ChatSystemFactsService) {}

  @Get()
  @MachineOnly()
  @WorkerKeyAllowed()
  async list(
    @CurrentUser() user: { id: number },
  ): Promise<ChatToolsResponseDto> {
    // Not the owner: no tools, so the model simply is not offered any.
    if (!(await this.facts.isOwner(user.id))) {
      return { definitions: [], prompt: '' };
    }

    return { definitions: CHAT_TOOL_DEFINITIONS, prompt: CHAT_TOOLS_PROMPT };
  }

  @Post('call')
  @MachineOnly()
  @WorkerKeyAllowed()
  @HttpCode(HttpStatus.OK)
  async call(
    @CurrentUser() user: { id: number },
    @Body() dto: CallChatToolDto,
  ): Promise<ChatToolResultDto> {
    if (!(await this.facts.isOwner(user.id))) {
      throw new ForbiddenException('Chat tools are for the deployment owner');
    }

    if (!toolNames().includes(dto.name)) {
      throw new NotFoundException(`Unknown tool: ${dto.name}`);
    }

    const args = dto.args ?? {};
    const text = await this.run(user.id, dto.name, args);

    return {
      result:
        text.length > MAX_RESULT_CHARS
          ? `${text.slice(0, MAX_RESULT_CHARS)}…`
          : text,
    };
  }

  private async run(
    userId: number,
    name: string,
    args: Record<string, unknown>,
  ): Promise<string> {
    if (name === 'system_status') {
      return this.facts.render(userId, { kind: 'broken' });
    }

    if (name === 'explain_run') {
      const id = Number(args.id);

      if (!Number.isInteger(id) || id <= 0) {
        return 'explain_run needs a positive integer id.';
      }

      return this.facts.render(userId, { kind: 'explain', id });
    }

    const limit = Number(args.limit) || 10;
    const status = typeof args.status === 'string' ? args.status : undefined;
    const rows = await this.facts.recent(userId, limit, status);

    return JSON.stringify(
      rows.map((row) => ({
        kind: row.source,
        id: row.id,
        status: row.status,
        model: row.model,
        what: row.title || undefined,
        at: row.at.toISOString(),
      })),
    );
  }
}
