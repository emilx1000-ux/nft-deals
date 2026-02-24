require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  console.log('❌ BOT_TOKEN missing');
  process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
console.log('🤖 Bot running');

// ================== DATA ==================

const DB_FILE = path.join(__dirname, 'db.json');

let db = {
  users: {},
  deals: {}
};

if (fs.existsSync(DB_FILE)) {
  db = JSON.parse(fs.readFileSync(DB_FILE));
}

function saveDB() {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function generateId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function ensureUser(id) {
  if (!db.users[id]) {
    db.users[id] = {
      ton: null,
      card: null
    };
    saveDB();
  }
  return db.users[id];
}

// ================== STATE ==================

const states = new Map();

// ================== MENUS ==================

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

function profileMenu() {
  return {
    reply_markup: {
      keyboard: [
        ['Добавить TON'],
        ['Добавить карту'],
        ['⬅ Назад']
      ],
      resize_keyboard: true
    }
  };
}

function currencyMenu() {
  return {
    reply_markup: {
      keyboard: [
        ['TON', 'USD'],
        ['RUB', 'EUR'],
        ['UAH']
      ],
      resize_keyboard: true
    }
  };
}

// ================== START ==================

bot.onText(/\/start(?: (.+))?/, async (msg, match) => {
  const userId = msg.from.id;
  ensureUser(userId);

  const payload = match[1];

  if (!payload) {
    states.delete(userId);
    return bot.sendMessage(msg.chat.id, '👋 Добро пожаловать', mainMenu());
  }

  if (payload.startsWith('deal_')) {
    const dealId = payload.split('_')[1];
    const deal = db.deals[dealId];

    if (!deal)
      return bot.sendMessage(msg.chat.id, '❌ Сделка не найдена');

    if (deal.status !== 'created')
      return bot.sendMessage(msg.chat.id, '❌ Сделка уже завершена');

    return bot.sendMessage(msg.chat.id,
`📝 Сделка #${deal.id}
💰 ${deal.amount} ${deal.currency}
📝 ${deal.description}
🔗 ${deal.nft}`,
{
  reply_markup: {
    inline_keyboard: [
      [{ text: '💳 Оплатить', callback_data: `pay_${deal.id}` }]
    ]
  }
});
  }
});

// ================== CALLBACKS ==================

bot.on('callback_query', async (q) => {
  const userId = q.from.id;
  const data = q.data;

  if (data.startsWith('pay_')) {
    const dealId = data.split('_')[1];
    const deal = db.deals[dealId];

    if (!deal)
      return bot.answerCallbackQuery(q.id, { text: '❌ Нет сделки', show_alert: true });

    if (deal.status !== 'created')
      return bot.answerCallbackQuery(q.id, { text: '❌ Уже оплачено', show_alert: true });

    deal.status = 'paid';
    deal.buyer = userId;
    saveDB();

    await bot.sendMessage(deal.seller,
      `💰 Сделка #${deal.id} оплачена.\nПередайте NFT покупателю.`);

    await bot.sendMessage(userId,
      `💳 Вы оплатили сделку #${deal.id}`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: '✅ Подтвердить получение', callback_data: `confirm_${deal.id}` }]
          ]
        }
      });

    return bot.answerCallbackQuery(q.id);
  }

  if (data.startsWith('confirm_')) {
    const dealId = data.split('_')[1];
    const deal = db.deals[dealId];

    if (!deal)
      return bot.answerCallbackQuery(q.id, { text: '❌ Нет сделки', show_alert: true });

    if (deal.buyer !== userId)
      return bot.answerCallbackQuery(q.id, { text: '❌ Не ваша сделка', show_alert: true });

    if (deal.status !== 'paid')
      return bot.answerCallbackQuery(q.id, { text: '❌ Оплата не подтверждена', show_alert: true });

    deal.status = 'completed';
    saveDB();

    await bot.sendMessage(deal.seller, `✅ Сделка #${deal.id} завершена`);
    await bot.sendMessage(userId, `🎉 Сделка завершена`);

    return bot.answerCallbackQuery(q.id);
  }
});

// ================== MESSAGE ==================

bot.on('message', async (msg) => {
  if (!msg.text || msg.text.startsWith('/')) return;

  const userId = msg.from.id;
  const text = msg.text;
  const user = ensureUser(userId);
  const state = states.get(userId);

  if (text === '⬅ Назад') {
    states.delete(userId);
    return bot.sendMessage(msg.chat.id, 'Главное меню', mainMenu());
  }

  if (text === '👤 Профиль') {
    states.delete(userId);
    return bot.sendMessage(msg.chat.id,
`👤 Профиль

TON: ${user.ton || '❌'}
Карта: ${user.card || '❌'}`,
profileMenu());
  }

  if (text === 'Добавить TON') {
    states.set(userId, { step: 'ton' });
    return bot.sendMessage(msg.chat.id, 'Введите TON кошелёк:');
  }

  if (text === 'Добавить карту') {
    states.set(userId, { step: 'card' });
    return bot.sendMessage(msg.chat.id, 'Введите номер карты:');
  }

  if (text === '➕ Создать сделку') {
    states.set(userId, { step: 'currency' });
    return bot.sendMessage(msg.chat.id, 'Выберите валюту:', currencyMenu());
  }

  if (!state) return;

  if (state.step === 'ton') {
    user.ton = text;
    states.delete(userId);
    saveDB();
    return bot.sendMessage(msg.chat.id, '✅ TON сохранён', mainMenu());
  }

  if (state.step === 'card') {
    user.card = text;
    states.delete(userId);
    saveDB();
    return bot.sendMessage(msg.chat.id, '✅ Карта сохранена', mainMenu());
  }

  if (state.step === 'currency') {
    const currency = text.toUpperCase();
    const cardCurrencies = ['USD', 'RUB', 'EUR', 'UAH'];

    if (currency === 'TON' && !user.ton)
      return bot.sendMessage(msg.chat.id, '❌ Добавьте TON');

    if (cardCurrencies.includes(currency) && !user.card)
      return bot.sendMessage(msg.chat.id, '❌ Добавьте карту');

    state.currency = currency;
    state.step = 'amount';
    return bot.sendMessage(msg.chat.id, 'Введите сумму:');
  }

  if (state.step === 'amount') {
    const amount = parseFloat(text);
    if (isNaN(amount) || amount <= 0)
      return bot.sendMessage(msg.chat.id, '❌ Неверная сумма');

    state.amount = amount;
    state.step = 'description';
    return bot.sendMessage(msg.chat.id, 'Введите описание:');
  }

  if (state.step === 'description') {
    state.description = text;
    state.step = 'nft';
    return bot.sendMessage(msg.chat.id, 'Отправьте ссылку NFT:');
  }

  if (state.step === 'nft') {
    const dealId = generateId();
    const me = await bot.getMe();

    db.deals[dealId] = {
      id: dealId,
      seller: userId,
      buyer: null,
      currency: state.currency,
      amount: state.amount,
      description: state.description,
      nft: text,
      status: 'created'
    };

    states.delete(userId);
    saveDB();

    const link = `https://t.me/${me.username}?start=deal_${dealId}`;

    return bot.sendMessage(msg.chat.id,
`✅ Сделка создана

#${dealId}
💰 ${state.amount} ${state.currency}

Ссылка:
${link}`,
mainMenu());
  }
});