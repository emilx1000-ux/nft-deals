require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = Number(process.env.ADMIN_ID);
const COMMISSION_PERCENT = 5; // комиссия бота

if (!BOT_TOKEN) {
  console.log('❌ Нет BOT_TOKEN');
  process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
console.log('🤖 Bot started');

// ================= DATABASE =================

const DB_FILE = './db.json';

let db = { users: {}, deals: {} };

if (fs.existsSync(DB_FILE)) {
  db = JSON.parse(fs.readFileSync(DB_FILE));
}

function save() {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function ensureUser(id) {
  if (!db.users[id]) {
    db.users[id] = { ton: null, card: null, deals: 0 };
    save();
  }
  return db.users[id];
}

function generateId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// ================= STATE =================

const states = new Map();

// ================= MENUS =================

function mainMenu() {
  return {
    reply_markup: {
      keyboard: [['➕ Сделка'], ['👤 Профиль']],
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

// ================= START =================

bot.onText(/\/start(?: (.+))?/, async (msg, match) => {
  const userId = msg.from.id;
  ensureUser(userId);

  const payload = match[1];

  if (!payload)
    return bot.sendMessage(msg.chat.id, 'Добро пожаловать в Escrow Bot', mainMenu());

  if (payload.startsWith('deal_')) {
    const dealId = payload.split('_')[1];
    const deal = db.deals[dealId];

    if (!deal)
      return bot.sendMessage(msg.chat.id, '❌ Сделка не найдена');

    if (deal.status !== 'created')
      return bot.sendMessage(msg.chat.id, '❌ Сделка недоступна');

    return bot.sendMessage(msg.chat.id,
`📝 Сделка #${deal.id}
💰 ${deal.amount} ${deal.currency}
Комиссия: ${COMMISSION_PERCENT}%
К оплате: ${deal.amount + deal.amount * COMMISSION_PERCENT / 100}
📝 ${deal.description}`,
{
  reply_markup: {
    inline_keyboard: [
      [{ text: '💳 Оплатить', callback_data: `pay_${deal.id}` }]
    ]
  }
});
  }
});

// ================= CALLBACK =================

bot.on('callback_query', async (q) => {
  const userId = q.from.id;
  const data = q.data;

  if (data.startsWith('pay_')) {
    const id = data.split('_')[1];
    const deal = db.deals[id];

    if (!deal || deal.status !== 'created')
      return bot.answerCallbackQuery(q.id, { text: 'Недоступно', show_alert: true });

    deal.status = 'paid';
    deal.buyer = userId;
    save();

    await bot.sendMessage(deal.seller,
`💰 Сделка #${deal.id} оплачена.
Передайте NFT покупателю.`);

    await bot.sendMessage(userId,
`Оплата прошла.
После получения NFT нажмите подтверждение.`,
{
  reply_markup: {
    inline_keyboard: [
      [{ text: '✅ Подтвердить', callback_data: `confirm_${deal.id}` }],
      [{ text: '⚠️ Спор', callback_data: `dispute_${deal.id}` }]
    ]
  }
});

    return bot.answerCallbackQuery(q.id);
  }

  if (data.startsWith('confirm_')) {
    const id = data.split('_')[1];
    const deal = db.deals[id];

    if (!deal || deal.buyer !== userId || deal.status !== 'paid')
      return bot.answerCallbackQuery(q.id, { text: 'Ошибка', show_alert: true });

    deal.status = 'completed';
    save();

    await bot.sendMessage(deal.seller, `✅ Сделка #${deal.id} завершена`);
    await bot.sendMessage(userId, `🎉 Успешно`);

    return bot.answerCallbackQuery(q.id);
  }

  if (data.startsWith('dispute_')) {
    const id = data.split('_')[1];
    const deal = db.deals[id];

    if (!deal)
      return bot.answerCallbackQuery(q.id);

    deal.status = 'dispute';
    save();

    await bot.sendMessage(ADMIN_ID,
`⚠️ СПОР по сделке #${deal.id}
Buyer: ${deal.buyer}
Seller: ${deal.seller}`);

    return bot.answerCallbackQuery(q.id, { text: 'Спор открыт' });
  }
});

// ================= MESSAGE =================

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
    return bot.sendMessage(msg.chat.id,
`👤 Профиль
TON: ${user.ton || '❌'}
Карта: ${user.card || '❌'}
Сделок: ${user.deals}`,
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

  if (text === '➕ Сделка') {
    states.set(userId, { step: 'currency' });
    return bot.sendMessage(msg.chat.id, 'Валюта (TON/USD/RUB/EUR/UAH):');
  }

  if (!state) return;

  if (state.step === 'ton') {
    user.ton = text;
    states.delete(userId);
    save();
    return bot.sendMessage(msg.chat.id, 'TON сохранён', mainMenu());
  }

  if (state.step === 'card') {
    user.card = text;
    states.delete(userId);
    save();
    return bot.sendMessage(msg.chat.id, 'Карта сохранена', mainMenu());
  }

  if (state.step === 'currency') {
    state.currency = text.toUpperCase();
    state.step = 'amount';
    return bot.sendMessage(msg.chat.id, 'Сумма:');
  }

  if (state.step === 'amount') {
    state.amount = parseFloat(text);
    state.step = 'description';
    return bot.sendMessage(msg.chat.id, 'Описание:');
  }

  if (state.step === 'description') {
    const dealId = generateId();
    const me = await bot.getMe();

    db.deals[dealId] = {
      id: dealId,
      seller: userId,
      buyer: null,
      currency: state.currency,
      amount: state.amount,
      description: text,
      status: 'created'
    };

    user.deals++;
    states.delete(userId);
    save();

    const link = `https://t.me/${me.username}?start=deal_${dealId}`;

    return bot.sendMessage(msg.chat.id,
`✅ Сделка создана
#${dealId}
${link}`,
mainMenu());
  }
});