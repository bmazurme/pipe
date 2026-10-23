import { SetMetadata } from '@nestjs/common';

export const BOARD_AGENT_KEY_ALLOWED = 'boardAgentKeyAllowed';

// Marks a route (or controller) a boards-only API key (`scope: 'boards'`) may call. Without it such a key is refused, so a
// key stolen from a board reaches the board agent's routes and nothing else of the owner's account.
export const BoardAgentKeyAllowed = () =>
  SetMetadata(BOARD_AGENT_KEY_ALLOWED, true);
