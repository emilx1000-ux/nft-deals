require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');

const BOT_TOKEN = process.env.BOT_TOKEN;

if (!BOT_TOKEN) {
  console.log('❌ Нет BOT_TOKEN');
  process.exit();
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

console.log('🤖 Bot started');

// ====== ADMIN ======
const ADMIN_IDS = [123456789]; // <-- ВСТАВЬ СВОЙ TELEGRAM ID

// ====== DATA ======
const DATA_FILE = path.join(__dirname, 'data.json');

let deals = new Map();
let users = new Map();
let sessions = new Map();

// ====== LOAD / SAVE ======
function loadData() {
  if (!fs.existsSync(DATA_FILE)) return;
  const data = JSON.parse(fs.readFileSync(DATA_FILE));
  deals = new Map(data.deals || []);
  users = new Map(data.users || []);
}

function saveData() {
  const data = {
    deals: [...deals],
    users: [...users]
  };
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

loadData();

// ====== HELPERS ======
function generateId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function mainMenu() {
  return {
    reply_markup: {
      keyboard: [
        ['➕ Создать сделку'],
        ['👤 Профиль']
      ],
      resize_keyboard: true
    }
  };
}

function currencyKeyboard() {
  return {
    reply_markup: {
      keyboard: [
        ['TON', 'USD'],
        ['RUB', 'EUR'],
        ['UAH', 'STARS']
      ],
      resize_keyboard: true,
      one_time_keyboard: true
    }
  };
}

// ====== START ======
bot.onText(/\/start(?: (.+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (!users.has(userId)) {
    users.set(userId, { ton: null, card: null });
    saveData();
  }

  const payload = match[1];

  if (!payload) {
    return bot.sendMessage(chatId, '👋 Добро пожаловать в NFT Deals Bot', mainMenu());
  }

  if (payload.startsWith('deal_')) {
    const dealId = payload.replace('deal_', '');
    const deal = deals.get(dealId);

    if (!deal)
      return bot.sendMessage(chatId, '❌ Сделка не найдена');

    return bot.sendMessage(chatId,
`📝 Сделка #${deal.id}
💰 ${deal.amount} ${deal.currency}
📝 ${deal.description}
🔗 NFT: ${deal.nft}
Статус: ${deal.status}`,
{
  reply_markup: {
    inline_keyboard: [
      deal.status === 'pending'
        ? [{ text: '💳 Оплатить', callback_data: `pay_${deal.id}` }]
        : []
    ]
  }
});
  }
});

// ====== PROFILE ======
bot.onText(/👤 Профиль/, (msg) => {
  const user = users.get(msg.from.id);

  bot.sendMessage(msg.chat.id,
`👤 Профиль:

TON: ${user.ton || '❌ Не добавлен'}
Карта: ${user.card || '❌ Не добавлена'}`,
{
  reply_markup: {
    keyboard: [
      ['Добавить TON'],
      ['Добавить карту'],
      ['⬅ Назад']
    ],
    resize_keyboard: true
  }
});
});

bot.onText(/Добавить TON/, (msg) => {
  sessions.set(msg.from.id, { step: 'add_ton' });
  bot.sendMessage(msg.chat.id, 'Введите TON кошелёк:');
});

bot.onText(/Добавить карту/, (msg) => {
  sessions.set(msg.from.id, { step: 'add_card' });
  bot.sendMessage(msg.chat.id, 'Введите номер карты:');
});

// ====== CREATE DEAL ======
bot.onText(/➕ Создать сделку/, (msg) => {
  sessions.set(msg.from.id, { step: 'currency' });
  bot.sendMessage(msg.chat.id, 'Выберите валюту:', currencyKeyboard());
});

// ====== CALLBACKS ======
bot.on('callback_query', async (query) => {
  const data = query.data;
  const userId = query.from.id;

  if (data.startsWith('pay_')) {
    const dealId = data.replace('pay_', '');
    const deal = deals.get(dealId);

    if (!deal)
      return bot.answerCallbackQuery(query.id, { text: '❌ Сделка не найдена', show_alert: true });

    if (deal.status !== 'pending')
      return bot.answerCallbackQuery(query.id, { text: '❌ Сделка уже оплачена', show_alert: true });

    deal.status = 'paid';
    deal.buyer = userId;
    saveData();

    await bot.sendMessage(deal.seller,
`💰 Покупатель оплатил сделку #${deal.id}
Передайте NFT покупателю.`);

    await bot.sendMessage(userId,
`💳 Вы оплатили сделку #${deal.id}`,
{
  reply_markup: {
    inline_keyboard: [
      [{ text: '✅ Подтвердить получение NFT', callback_data: `confirm_${deal.id}` }]
    ]
  }
});

    return bot.answerCallbackQuery(query.id);
  }

  if (data.startsWith('confirm_')) {
    const dealId = data.replace('confirm_', '');
    const deal = deals.get(dealId);

    if (!deal)
      return bot.answerCallbackQuery(query.id, { text: '❌ Сделка не найдена', show_alert: true });

    if (deal.buyer !== userId)
      return bot.answerCallbackQuery(query.id, { text: '❌ Это не ваша сделка', show_alert: true });

    if (deal.status !== 'paid')
      return bot.answerCallbackQuery(query.id, { text: '❌ Оплата ещё не подтверждена', show_alert: true });

    deal.status = 'completed';
    saveData();

    await bot.sendMessage(deal.seller, `✅ Сделка #${deal.id} завершена`);
    await bot.sendMessage(userId, `🎉 Сделка завершена`);

    return bot.answerCallbackQuery(query.id);
  }
});

// ====== MESSAGE HANDLER ======
bot.on('message', async (msg) => {
  if (!msg.text) return;
  if (msg.text.startsWith('/')) return;

  if (msg.text === '⬅ Назад') {
    sessions.delete(msg.from.id);
    return bot.sendMessage(msg.chat.id, 'Главное меню', mainMenu());
  }

  const session = sessions.get(msg.from.id);
  if (!session) return;

  const user = users.get(msg.from.id);

  // Добавление TON
  if (session.step === 'add_ton') {
    user.ton = msg.text;
    sessions.delete(msg.from.id);
    saveData();
    return bot.sendMessage(msg.chat.id, '✅ TON добавлен', mainMenu());
  }

  // Добавление карты
  if (session.step === 'add_card') {
    user.card = msg.text;
    sessions.delete(msg.from.id);
    saveData();
    return bot.sendMessage(msg.chat.id, '✅ Карта добавлена', mainMenu());
  }

  // Валюта
  if (session.step === 'currency') {
    const currency = msg.text.toUpperCase();
    const needsCard = ['USD', 'RUB', 'EUR', 'UAH'];

    if (currency === 'TON' && !user.ton)
      return bot.sendMessage(msg.chat.id, '❌ Добавьте TON в профиле');

    if (needsCard.includes(currency) && !user.card)
      return bot.sendMessage(msg.chat.id, '❌ Добавьте карту в профиле');

    session.currency = currency;
    session.step = 'amount';
    return bot.sendMessage(msg.chat.id, 'Введите сумму:');
  }

  // Сумма
  if (session.step === 'amount') {
    const amount = parseFloat(msg.text);

    if (isNaN(amount) || amount <= 0)
      return bot.sendMessage(msg.chat.id, '❌ Введите корректную сумму');

    session.amount = amount;
    session.step = 'description';
    return bot.sendMessage(msg.chat.id, 'Введите описание:');
  }

  // Описание
  if (session.step === 'description') {
    session.description = msg.text;
    session.step = 'nft';
    return bot.sendMessage(msg.chat.id, 'Отправьте ссылку на NFT:');
  }

  // NFT
  if (session.step === 'nft') {
    const dealId = generateId();
    const me = await bot.getMe();

    const deal = {
      id: dealId,
      seller: msg.from.id,
      currency: session.currency,
      amount: session.amount,
      description: session.description,
      nft: msg.text,
      status: 'pending'
    };

    deals.set(dealId, deal);
    sessions.delete(msg.from.id);
    saveData();

    const link = `https://t.me/${me.username}?start=deal_${dealId}`;

    return bot.sendMessage(msg.chat.id,
`✅ Сделка создана!

#${dealId}
💰 ${deal.amount} ${deal.currency}

🔗 Ссылка для покупателя:
${link}`,
mainMenu());
  }
});