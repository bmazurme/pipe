import { useListProviderCredentialsQuery } from '../../store/api';
import { modelLabel } from '../improve/improveLabels';
import { MODEL_OPTIONS } from './constants';

export type ModelOption = { value: string; content: string };

// Improve and Lab keep a run's model in one string: a named model ("sonnet"), or "custom:<id of the stored key>" for a model of
// the owner's own server — the key says which. So their pickers list every custom key as a model of its own, and not the bare
// "custom" a Worker job is made with.
export const AUTO_OPTION: ModelOption = { value: 'auto', content: 'Авто (маршрутизатор выбирает)' };

// `auto` adds the router's own choice — Lab only (Improve does not route).
export function useModelOptions(withAuto = false): { options: ModelOption[]; label: (model: string) => string } {
  const { data } = useListProviderCredentialsQuery();
  const keys = (Array.isArray(data) ? data : []).filter((key) => key.provider === 'custom');
  const options: ModelOption[] = [
    ...(withAuto ? [AUTO_OPTION] : []),
    ...MODEL_OPTIONS.filter((option) => option.value !== 'custom'),
    ...keys.map((key) => ({ value: `custom:${key.id}`, content: `${key.name}${key.model ? ` · ${key.model}` : ''}` })),
  ];

  return { options, label: (model) => options.find((option) => option.value === model)?.content ?? modelLabel(model) };
}
