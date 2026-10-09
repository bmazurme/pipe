import { API_URL } from '../../store/api';
import { ChatAttachmentMeta, MAX_ATTACHMENT_BYTES } from '../../store/api';

const ALLOWED_EXTENSIONS = [
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.pdf', '.txt', '.md', '.markdown', '.json', '.csv', '.tsv', '.log', '.yml', '.yaml', '.toml', '.xml',
  '.html', '.css', '.js', '.jsx', '.mjs', '.ts', '.tsx', '.py', '.java', '.kt', '.go', '.rs', '.rb', '.php', '.c', '.h', '.cpp', '.cs', '.sh', '.sql',
  '.diff', '.patch',
];

/** Same list as the backend's (apps/backend/src/chat/attachments.ts) — it re-checks, this only spares a doomed upload. */
export const ATTACHMENT_ACCEPT = ALLOWED_EXTENSIONS.join(',');

export const isClaudeModel = (model: string | undefined): boolean => model === 'sonnet' || model === 'opus';

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;

  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

/** The reason a file cannot be attached, or null when it can. */
export function attachmentProblem(file: Pick<File, 'name' | 'size'>): string | null {
  const dot = file.name.lastIndexOf('.');
  const extension = dot >= 0 ? file.name.slice(dot).toLowerCase() : '';

  if (!ALLOWED_EXTENSIONS.includes(extension)) {
    return `«${file.name}»: такой тип файла нельзя прикрепить — подходят изображения, pdf, текст и исходный код`;
  }
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return `«${file.name}» больше ${MAX_ATTACHMENT_BYTES / (1024 * 1024)} МБ`;
  }

  return null;
}

async function messageOf(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => null)) as { message?: string | string[] } | null;
  const message = Array.isArray(body?.message) ? body?.message.join(', ') : body?.message;

  return message ?? fallback;
}

export async function uploadChatAttachment(chatId: number, file: File, accessToken: string | null): Promise<ChatAttachmentMeta> {
  const problem = attachmentProblem(file);

  if (problem) throw new Error(problem);

  const form = new FormData();
  form.append('file', file, file.name);

  const response = await fetch(`${API_URL}/api/v1/chat/chats/${chatId}/attachments`, {
    method: 'POST',
    body: form,
    credentials: 'include',
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
  });

  if (!response.ok) throw new Error(await messageOf(response, `Не удалось загрузить «${file.name}»`));

  return (await response.json()) as ChatAttachmentMeta;
}

export async function deleteChatAttachment(id: number, accessToken: string | null): Promise<void> {
  await fetch(`${API_URL}/api/v1/chat/attachments/${id}`, {
    method: 'DELETE',
    credentials: 'include',
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
  });
}

/** An <img>/<a> cannot send the bearer token, so a file is fetched and shown from a blob URL. */
export async function fetchAttachmentBlobUrl(id: number, accessToken: string | null): Promise<string> {
  const response = await fetch(`${API_URL}/api/v1/chat/attachments/${id}/content`, {
    credentials: 'include',
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
  });

  if (!response.ok) throw new Error('Не удалось загрузить файл');

  return URL.createObjectURL(await response.blob());
}
