import { useEffect, useRef, useState } from 'react';

import type { ChatMessageMeta } from '../../store/api';
import { fetchAttachmentBlobUrl } from './chatAttachments';

// Blob URLs of the images in a conversation, by attachment id. Each image is fetched once (with
// the bearer token an <img> could not send) and released when the page closes.
export function useAttachmentUrls(messages: ChatMessageMeta[], accessToken: string | null): Record<number, string> {
  const [urls, setUrls] = useState<Record<number, string>>({});
  const requested = useRef(new Set<number>());
  const created = useRef<string[]>([]);

  useEffect(() => {
    const wanted = messages.flatMap((message) => message.attachments ?? []).filter((attachment) => attachment.isImage && !requested.current.has(attachment.id));

    for (const attachment of wanted) {
      requested.current.add(attachment.id);
      fetchAttachmentBlobUrl(attachment.id, accessToken)
        .then((url) => {
          created.current.push(url);
          setUrls((current) => ({ ...current, [attachment.id]: url }));
        })
        .catch(() => requested.current.delete(attachment.id));
    }
  }, [messages, accessToken]);

  useEffect(
    () => () => {
      for (const url of created.current) URL.revokeObjectURL(url);
    },
    [],
  );

  return urls;
}
