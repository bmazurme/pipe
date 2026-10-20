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
    usedFor: 'Модели Claude Sonnet, Opus и Haiku',
    steps: [
      'Нужна подписка Claude (Pro или Max) и установленный Claude Code: npm install -g @anthropic-ai/claude-code.',
      'В терминале на своём компьютере выполните: claude setup-token.',
      'Войдите в аккаунт Claude в открывшемся браузере и подтвердите доступ.',
      'Команда выведет долгоживущий токен вида sk-ant-oat01-… Скопируйте его сразу — повторно он не показывается.',
    ],
    whereToPut:
      'Вкладка «Ключи и подключения» → «Claude-токены»: имя + токен. Хранится в bridge в зашифрованном виде и выдаётся worker\'у вместе с задачей — в переменных среды worker\'а токен не нужен, передеплой не требуется.',
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
    whereToPut: 'Вкладка «Ключи и подключения» → «API-ключи моделей»: провайдер, название и ключ. Выдаётся worker\'у вместе с задачей, передеплой не нужен.',
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
    whereToPut: 'Вкладка «Ключи и подключения» → «API-ключи моделей»: провайдер, название и ключ. Выдаётся worker\'у вместе с задачей, передеплой не нужен.',
    links: [{ label: 'platform.deepseek.com/api_keys', href: 'https://platform.deepseek.com/api_keys', external: true }],
  },
  {
    id: 'qwen',
    title: 'Qwen API Key',
    usedFor: 'Модель Qwen (по умолчанию qwen-plus)',
    steps: [
      'Откройте Alibaba Cloud Model Studio (DashScope) и войдите.',
      'Раздел API-KEY → создайте ключ и скопируйте его (вида sk-…).',
      'Ключ работает только в своём регионе. По умолчанию worker обращается к dashscope.aliyuncs.com; для международной консоли в блоке «Свой адрес или модель» при добавлении ключа укажите https://dashscope-intl.aliyuncs.com/compatible-mode/v1.',
    ],
    whereToPut: 'Вкладка «Ключи и подключения» → «API-ключи моделей»: провайдер, название и ключ. Выдаётся worker\'у вместе с задачей, передеплой не нужен.',
    links: [{ label: 'Alibaba Cloud Model Studio', href: 'https://www.alibabacloud.com/help/en/model-studio/get-api-key', external: true }],
  },
  {
    id: 'worker',
    title: 'Подключение worker\'а к bridge',
    usedFor: 'Сам процесс worker: он забирает задачи и отправляет результат',
    steps: [
      'Откройте вкладку «Worker\'ы» и нажмите «Добавить worker», введите название.',
      'Скопируйте одноразовый код и команду из подсказки (код действует 30 минут и подходит один раз).',
      'Выполните команду на сервере, где будет работать worker. Он сам получит собственный ключ и появится в списке как «Свободен».',
    ],
    whereToPut:
      'Вкладка «Worker\'ы». Никаких ключей bridge в переменных среды worker\'а не нужно: он хранит свой ключ у себя (том), а настройки — пауза, модели, таймаут, прокси — меняются здесь без перезапуска.',
    links: [{ label: 'Вкладка «Worker\'ы»', href: '?tab=workers' }],
    note: 'Удалить worker здесь значит отозвать его ключ сразу.',
  },
  {
    id: 'vpn',
    title: 'VPN для обращений к ИИ-провайдерам',
    usedFor: 'Если с сервера worker провайдеры недоступны напрямую',
    steps: [
      'Добавьте подключение к VPN-панели на странице VPN (адрес панели и её API-токен).',
      'Вернитесь сюда и выберите это подключение в блоке «VPN» (вкладка «Ключи и подключения»).',
    ],
    whereToPut: 'Страница VPN, затем выбор подключения в блоке «VPN» на вкладке «Ключи и подключения».',
    links: [{ label: 'Страница VPN', href: '/vpn' }],
  },
];
