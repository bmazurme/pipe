import { Alert, Loader } from '@gravity-ui/uikit';

import { Dialog } from '../../shared/ui/Dialog';
import { useGetContextQuery, type ContextSummary } from '../../store/api';
import { SaveKnowledgeDialog } from '../ImprovePage/SaveKnowledgeDialog';

interface ContextKnowledgeProps {
  context: ContextSummary;
  onClose: () => void;
}

// The list only carries summaries, so the text is fetched when the context is picked; the dialog opens once it is here.
export function ContextKnowledge({ context, onClose }: ContextKnowledgeProps) {
  const { data, isError } = useGetContextQuery(context.id);

  if (data) return <SaveKnowledgeDialog key={data.id} initialTitle={data.name} initialText={data.content} source={`Context «${data.name}»`} onClose={onClose} />;

  return (
    <Dialog open onClose={onClose} maxWidth="s" aria-labelledby="context-knowledge-title">
      <Dialog.Header caption="Сохранить как постоянное знание" id="context-knowledge-title" />
      <Dialog.Body>
        {isError ? <Alert theme="danger" view="filled" message="Не удалось загрузить контекст" /> : <Loader size="m" />}
      </Dialog.Body>
      <Dialog.Footer textButtonApply="Закрыть" onClickButtonApply={onClose} />
    </Dialog>
  );
}
