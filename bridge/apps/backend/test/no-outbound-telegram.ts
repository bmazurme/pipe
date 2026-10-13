// e2e tests boot the real app with whatever .env the machine has — on a developer's machine that is the real Telegram
// bot and chat. An empty value here wins over the file (dotenv never overrides a variable that is already set), so no
// e2e test can send a real message. Found when an e2e run told the owner "🚨 emergency key used".
process.env.TELEGRAM_BOT_TOKEN = '';
process.env.TELEGRAM_CHAT_ID = '';
process.env.TELEGRAM_WEBHOOK_SECRET = '';
