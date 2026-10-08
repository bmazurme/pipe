export interface HelpLink {
  label: string;
  /** An external site (opened in a new tab) or an in-app path. */
  href: string;
  external?: boolean;
}

export interface HelpTopic {
  id: string;
  title: string;
  /** Which models/features need it. */
  usedFor: string;
  steps: string[];
  /** Where to put the result in this app. */
  whereToPut: string;
  links: HelpLink[];
  note?: string;
}

// Every credential the Worker page can take, in the order the page lists them. Kept as data
// so the instructions can be reviewed (and tested) apart from the layout.
export const HELP_TOPICS: HelpTopic[] = [
  {
    id: 'claude',
    title: 'Claude Code OAuth-токен',
    usedFor: 'Модели Claude Sonnet и Claude Opus',
    steps: [
      'Нужна подписка Claude (Pro или Max) и установленный Claude Code: npm install -g @anthropic-ai/claude-code.',
      'В терминале на своём компьютере выполните: claude setup-token.',
      'Войдите в аккаунт Claude в открывшемся браузере и подтвердите доступ.',
      'Команда выведет долгоживущий токен вида sk-ant-oat01-… Скопируйте его сразу — повторно он не показывается.',
    ],
    whereToPut:
      'Лучше в «Claude-токены» ниже: имя + токен, хранятся на bridge в зашифрованном виде и применяются к задаче без передеплоя. Либо в «Ключи worker» → «Claude Code OAuth Token» — общий токен по умолчанию, но сохранение запускает передеплой worker.',
    links: [{ label: 'Документация Claude Code', href: 'https://docs.claude.com/en/docs/claude-code', external: true }],
    note: 'Токен даёт доступ к вашей подписке — не публикуйте его и не коммитьте.',
  },
  {
    id: 'openai',
    title: 'OpenAI API Key',
    usedFor: 'Модель GPT (по умолчанию gpt-4o)',
    steps: [
      'Откройте platform.openai.com и войдите (это отдельный аккаунт и баланс от ChatGPT).',
      'Billing → пополните баланс: без него API-запросы не проходят.',
      'API keys → Create new secret key, дайте имя и скопируйте ключ вида sk-proj-… — он показывается один раз.',
    ],
    whereToPut: '«Ключи worker» → «OpenAI API Key». Сохранение запускает передеплой worker (~15 минут).',
    links: [{ label: 'platform.openai.com/api-keys', href: 'https://platform.openai.com/api-keys', external: true }],
  },
  {
    id: 'deepseek',
    title: 'DeepSeek API Key',
    usedFor: 'Модель DeepSeek (по умолчанию deepseek-chat)',
    steps: [
      'Откройте platform.deepseek.com и зарегистрируйтесь.',
      'Top up — пополните баланс.',
      'API keys → Create new API key, скопируйте ключ вида sk-… — он показывается один раз.',
    ],
    whereToPut: '«Ключи worker» → «DeepSeek API Key». Сохранение запускает передеплой worker (~15 минут).',
    links: [{ label: 'platform.deepseek.com/api_keys', href: 'https://platform.deepseek.com/api_keys', external: true }],
  },
  {
    id: 'qwen',
    title: 'Qwen API Key',
    usedFor: 'Модель Qwen (по умолчанию qwen-plus)',
    steps: [
      'Откройте Alibaba Cloud Model Studio (DashScope) и войдите.',
      'Раздел API-KEY → создайте ключ и скопируйте его (вида sk-…).',
      'Ключ работает только в своём регионе. По умолчанию worker обращается к dashscope.aliyuncs.com; для международной консоли в окружении worker задают QWEN_BASE_URL=https://dashscope-intl.aliyuncs.com/compatible-mode/v1.',
    ],
    whereToPut: '«Ключи worker» → «Qwen API Key». Сохранение запускает передеплой worker (~15 минут).',
    links: [{ label: 'Alibaba Cloud Model Studio', href: 'https://www.alibabacloud.com/help/en/model-studio/get-api-key', external: true }],
  },
  {
    id: 'bridge',
    title: 'Ключ доступа worker к bridge',
    usedFor: 'Сам процесс worker: по нему он забирает задачи и отправляет результат',
    steps: [
      'Откройте профиль → «API-ключи» → создайте ключ (например, «worker»).',
      'Скопируйте его сразу — после закрытия окна ключ не показывается.',
      'Сохраните его как секрет WORKER_BRIDGE_API_KEY в GitHub Actions репозитория и запустите деплой.',
    ],
    whereToPut: 'GitHub → Settings → Secrets and variables → Actions → WORKER_BRIDGE_API_KEY. На этой странице он не вводится.',
    links: [{ label: 'Профиль → API-ключи', href: '/profile' }],
  },
  {
    id: 'vpn',
    title: 'VPN для обращений к ИИ-провайдерам',
    usedFor: 'Если с сервера worker провайдеры недоступны напрямую',
    steps: [
      'Добавьте подключение к VPN-панели на странице VPN (адрес панели и её API-токен).',
      'Вернитесь сюда и выберите это подключение в блоке «VPN».',
    ],
    whereToPut: 'Страница VPN, затем выбор подключения в блоке «VPN» на этой странице.',
    links: [{ label: 'Страница VPN', href: '/vpn' }],
  },
];
