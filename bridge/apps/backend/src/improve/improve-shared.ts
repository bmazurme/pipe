import { AnalysisCategory, BacklogItem } from './analysis';

export const PR_LABEL = 'loop';

export interface AnalysisResult {
  categories: AnalysisCategory[];
  autoCreate: boolean;
  autoStart?: boolean;
  items: Array<
    BacklogItem & {
      issueNumber?: number;
      duplicateOf?: number;
      started?: boolean;
    }
  >;
}

export function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
