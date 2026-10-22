// Files attached to a task before it is pushed (a screenshot, a .msg, a .json, a log — any format): limits, and turning picked or
// pasted files into attachments.
export const MAX_ATTACHMENTS = 10;
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
// Only a picture has a preview; the server tells pictures from other files by their bytes, not by this.
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

export interface Attachment {
  id: string;
  name: string;
  size: number;
  base64: string;
  /** An object URL for a picture, '' for any other file. */
  previewUrl: string;
}

function readAsBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
    reader.onerror = () => reject(reader.error ?? new Error('Не удалось прочитать файл'));
    reader.readAsDataURL(file);
  });
}

export function formatSize(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} КБ` : `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}

// Turns picked or pasted files into attachments, one message per file that cannot be taken.
export async function toAttachments(files: File[], already: number): Promise<{ added: Attachment[]; problems: string[] }> {
  const added: Attachment[] = [];
  const problems: string[] = [];

  for (const file of files) {
    const label = file.name || 'файл';

    if (file.size === 0) {
      problems.push(`«${label}» пустой`);
    } else if (file.size > MAX_ATTACHMENT_BYTES) {
      problems.push(`«${label}» больше ${MAX_ATTACHMENT_BYTES / 1024 / 1024} МБ`);
    } else if (already + added.length >= MAX_ATTACHMENTS) {
      problems.push(`Не больше ${MAX_ATTACHMENTS} вложений — «${label}» не добавлен`);
    } else {
      added.push({
        id: `${Date.now()}-${added.length}-${label}`,
        name: file.name || (IMAGE_TYPES.includes(file.type) ? 'screenshot.png' : 'file'),
        size: file.size,
        base64: await readAsBase64(file),
        previewUrl: IMAGE_TYPES.includes(file.type) ? URL.createObjectURL(file) : '',
      });
    }
  }

  return { added, problems };
}
