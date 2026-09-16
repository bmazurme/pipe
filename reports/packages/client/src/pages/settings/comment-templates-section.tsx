import { useState } from 'react';
import {
  Button, TextInput, Text, Icon, Dialog, DialogHeader, DialogBody, DialogFooter, useToaster,
} from '@gravity-ui/uikit';
import { Pencil, Plus, TrashBin } from '@gravity-ui/icons';
import type { CommentTemplateType } from '@reports/shared';

import {
  useGetSubscriptionConfigQuery,
  useAddCommentTemplateMutation,
  useRemoveCommentTemplateMutation,
} from '../../store/api';
import { describeError } from '../../utils/describe-error';

import style from './settings.module.css';

const emptyForm = { title: '', body: '' };

function bodyPreview(body: string): string {
  const oneLine = body.replace(/\s+/g, ' ').trim();

  return oneLine.length > 80 ? `${oneLine.slice(0, 80)}…` : oneLine;
}

function CommentTemplatesSection() {
  const toaster = useToaster();
  const { data: config } = useGetSubscriptionConfigQuery();
  const [addCommentTemplate, { isLoading: isSaving }] = useAddCommentTemplateMutation();
  const [removeCommentTemplate] = useRemoveCommentTemplateMutation();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<CommentTemplateType | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [toRemove, setToRemove] = useState<CommentTemplateType | null>(null);

  const templates = config?.commentTemplates ?? [];

  const openAddDialog = () => {
    setEditingTemplate(null);
    setForm(emptyForm);
    setIsDialogOpen(true);
  };

  const openEditDialog = (template: CommentTemplateType) => {
    setEditingTemplate(template);
    setForm({ title: template.title, body: template.body });
    setIsDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.title.trim() || !form.body.trim()) {
      return;
    }

    const template: CommentTemplateType = {
      id: editingTemplate?.id ?? crypto.randomUUID(),
      title: form.title.trim(),
      body: form.body.trim(),
    };

    setIsDialogOpen(false);
    setForm(emptyForm);
    setEditingTemplate(null);

    try {
      await addCommentTemplate(template).unwrap();
    } catch (error) {
      toaster.add({
        name: 'comment-template-save-error',
        theme: 'danger',
        title: editingTemplate ? 'Не удалось сохранить шаблон' : 'Не удалось добавить шаблон',
        content: describeError(error),
        isClosable: true,
      });
    }
  };

  const handleRemove = async () => {
    const template = toRemove;

    setToRemove(null);

    if (!template) {
      return;
    }

    try {
      await removeCommentTemplate({ id: template.id }).unwrap();
    } catch (error) {
      toaster.add({
        name: 'comment-template-remove-error',
        theme: 'danger',
        title: 'Не удалось удалить шаблон',
        content: describeError(error),
        isClosable: true,
      });
    }
  };

  return (
    <>
      <section className={style.codes}>
        <div className={style.sectionHead}>
          <Text variant="subheader-2">Шаблоны комментариев</Text>
          <Text variant="caption-2" color="secondary">
            Выбираются на шаге publish в Subscription. {'{{branch}}'} подставляется автоматически
          </Text>
        </div>
        {templates.length === 0 ? (
          <Text variant="body-2" color="secondary" className={style.codesEmpty}>
            Шаблоны ещё не добавлены
          </Text>
        ) : (
          <ul className={style.codesList}>
            {templates.map((template) => (
              <li key={template.id} className={style.codesItem}>
                <button type="button" className={style.templateRowButton} onClick={() => openEditDialog(template)}>
                  <Text variant="body-2" className={style.rowTitle}>{template.title}</Text>
                  <Text variant="caption-2" color="secondary" className={style.rowTitle}>{bodyPreview(template.body)}</Text>
                </button>
                <Button view="flat" size="s" onClick={() => openEditDialog(template)} aria-label={`Редактировать шаблон ${template.title}`}>
                  <Icon data={Pencil} size={16} />
                </Button>
                <Button
                  view="flat"
                  size="s"
                  onClick={() => setToRemove(template)}
                  aria-label={`Удалить шаблон ${template.title}`}
                  className={style.codesRemove}
                >
                  <Icon data={TrashBin} size={16} />
                </Button>
              </li>
            ))}
          </ul>
        )}
        <Button view="outlined" size="m" width="max" onClick={openAddDialog} className={style.codesAdd}>
          <Icon data={Plus} size={16} />
          Добавить шаблон
        </Button>
      </section>

      <Dialog open={isDialogOpen} onClose={() => setIsDialogOpen(false)}>
        <DialogHeader caption={editingTemplate ? 'Редактировать шаблон' : 'Добавить шаблон комментария'} />
        <DialogBody>
          <div className={style.codeForm}>
            <TextInput
              label="Название"
              placeholder="Готово к ревью"
              value={form.title}
              onUpdate={(title) => setForm((prev) => ({ ...prev, title }))}
            />
            <div>
              <label htmlFor="comment-template-body">
                <Text variant="body-short">Текст комментария</Text>
              </label>
              <textarea
                id="comment-template-body"
                className={style.templateBody}
                placeholder="Ветка {{branch}} готова, изменения запушены."
                value={form.body}
                onChange={(event) => setForm((prev) => ({ ...prev, body: event.target.value }))}
              />
            </div>
          </div>
        </DialogBody>
        <DialogFooter
          onClickButtonCancel={() => setIsDialogOpen(false)}
          onClickButtonApply={handleSave}
          textButtonApply={editingTemplate ? 'Сохранить' : 'Добавить'}
          textButtonCancel="Отмена"
          propsButtonApply={{ disabled: !form.title.trim() || !form.body.trim(), loading: isSaving }}
        />
      </Dialog>

      <Dialog open={!!toRemove} onClose={() => setToRemove(null)}>
        <DialogHeader caption="Удалить шаблон" />
        <DialogBody>
          Удалить шаблон «{toRemove?.title}»?
        </DialogBody>
        <DialogFooter
          onClickButtonCancel={() => setToRemove(null)}
          onClickButtonApply={handleRemove}
          textButtonApply="Удалить"
          textButtonCancel="Отмена"
          propsButtonApply={{ view: 'outlined-danger' }}
        />
      </Dialog>
    </>
  )
}

export default CommentTemplatesSection;
