import { Alert, Button, Label, Text } from '@gravity-ui/uikit';

import { getErrorMessage, type ModelCards as ModelCardsData, type TierAdvice, useGetImproveModelCardsQuery, useGetRouterSettingsQuery, useSaveRouterSettingsMutation } from '../../store/api';
import { byTier, minutes, percent, usd, VERDICT_LABEL, VERDICT_THEME } from './modelCardsFacts';
import styles from './QualityTab.module.css';

const ADVICE_LABEL: Record<TierAdvice['status'], string> = {
  keep: 'оставить',
  switch: 'сменить',
  collect: 'ждём данных',
  'no-data': 'нет задач',
};

function AdviceRow({ advice, applying, onApply }: { advice: TierAdvice; applying: boolean; onApply: () => void }) {
  return (
    <div className={styles.adviceRow}>
      <Label theme={advice.status === 'switch' ? 'warning' : advice.status === 'keep' ? 'success' : 'unknown'} size="s">
        ярус {advice.tier}: {ADVICE_LABEL[advice.status]}
      </Label>
      <Text variant="body-1">{advice.reason}</Text>
      {advice.status === 'switch' && advice.suggested && (
        <Button size="s" view="outlined-action" loading={applying} onClick={onApply} title="Записать в настройки роутера: ярус → эта модель. Вернуть можно там же.">
          Поставить «{advice.suggested}» на ярус {advice.tier}
        </Button>
      )}
    </div>
  );
}

// A10: what each model really closes at each size tier, and the router's table checked against it. Advice only: pressing the button is the owner's decision.
export function ModelCards({ days }: { days: number }) {
  const cards = useGetImproveModelCardsQuery(days);
  const settings = useGetRouterSettingsQuery();
  const [save, { isLoading: saving, originalArgs, error: saveError }] = useSaveRouterSettingsMutation();
  const data: ModelCardsData | undefined = cards.data && Array.isArray(cards.data.cells) && Array.isArray(cards.data.advice) ? cards.data : undefined;

  if (cards.isLoading || !data) {
    return cards.isError ? <Alert theme="danger" message={getErrorMessage(cards.error, 'Не удалось загрузить карточки моделей')} /> : null;
  }

  if (data.cells.length === 0) return null;

  const apply = (advice: TierAdvice) => {
    if (!settings.data || !advice.suggested) return;

    void save({ ...settings.data, tierModels: { ...settings.data.tierModels, [String(advice.tier)]: advice.suggested } as typeof settings.data.tierModels });
  };

  return (
    <div className={styles.block} data-testid="model-cards">
      <Text variant="subheader-1">Карточки моделей</Text>
      <div className={styles.scroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Ярус · модель</th>
              <th scope="col" title="Начато на этой модели / влито / закрыто без слияния">
                PR
              </th>
              <th scope="col" title="Сколько раз модели не хватило и работу пришлось повторить на ступень выше">
                шагов вверх
              </th>
              <th scope="col" title="Влито ÷ (влито + закрыто + шагов вверх): сколько завершённых попыток модель довела сама">
                закрыла сама
              </th>
              <th scope="col">с 1-го раза</th>
              <th scope="col" title="Медиана работы агента на влитый PR: время заданий, ремонты включены. Для старых PR не записано">
                работа
              </th>
              <th scope="col" title="Что стоит начать задачу на этой модели, на одну влитую; шаг вверх включён">
                за влитый
              </th>
              <th scope="col" />
            </tr>
          </thead>
          <tbody>
            {byTier(data.cells).flatMap((group) =>
              group.cells.map((cell) => (
                <tr key={`${cell.tier}|${cell.model}`}>
                  <th scope="row">
                    ярус {cell.tier} · {cell.model}
                  </th>
                  <td>
                    {cell.prs} / {cell.merged} / {cell.closed}
                  </td>
                  <td>{cell.stepUps}</td>
                  <td>{percent(cell.closeRate)}</td>
                  <td>{percent(cell.firstGreenRate)}</td>
                  <td>{minutes(cell.medianWorkMinutes)}</td>
                  <td>{usd(cell.costPerMergedUsd)}</td>
                  <td>
                    <Label size="s" theme={VERDICT_THEME[cell.verdict]} title={`Нужно хотя бы ${data.rules.minSamples} завершённых попыток; «надёжно» — закрыла сама ≥ ${Math.round(data.rules.solidCloseRate * 100)} %`}>
                      {VERDICT_LABEL[cell.verdict]}
                    </Label>
                  </td>
                </tr>
              )),
            )}
          </tbody>
        </table>
      </div>

      <Text variant="subheader-1">Таблица роутера по этим данным</Text>
      {saveError && <Alert theme="danger" message={getErrorMessage(saveError, 'Не удалось сохранить настройки роутера')} />}
      {data.advice.map((advice) => (
        <AdviceRow key={advice.tier} advice={advice} applying={saving && originalArgs?.tierModels?.[String(advice.tier) as '1'] === advice.suggested} onApply={() => apply(advice)} />
      ))}
      <Text color="secondary" variant="caption-2">
        Это подсказка: роутер сам ничего не меняет. Карточка модели — это PR, начатые на ней сразу; PR, которым понадобилась ступень выше, записаны слабой модели как «шаг вверх», а не сильной как успех. Работа агента записывается с этой версии, у старых PR её нет.
      </Text>
    </div>
  );
}
