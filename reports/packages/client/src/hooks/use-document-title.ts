import { useEffect } from 'react';

const BASE_TITLE = 'ntlstl.time';

export const useDocumentTitle = (title?: string) => {
  useEffect(() => {
    document.title = title ? `${title} · ${BASE_TITLE}` : BASE_TITLE;

    return () => {
      document.title = BASE_TITLE;
    };
  }, [title]);
};
