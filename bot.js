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
console.log('🤖 Bot started');

// ================= DATA =================

const DATA_FILE = path.join(__dirname, 'data.json');

let users = new Map();
let deals = new Map();
let states = new Map(); // FSM

function load() {
  if (!fs.existsSync(DATA_FILE)) return;
  const data = JSON.parse(fs.readFileSync(DATA_FILE));
  users = new Map(data.users || []);
  deals = new Map(data.deals || []);
}

function save() {
  fs.writeFileSync(DATA_FILE, JSON.stringify({
    users: [...users],
    deals: [...deals]
  }, null, 2));
}

load();

// ================= HELPERS =================

function id() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function ensureUser(userId) {
  if (!users.has(userId)) {
    users.set(userId, { ton: null, card: null });
    save();
  }
  return users.get(userId);
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

// ================= START =================

bot.onText(/\/start(?: (.+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  ensureUser(userId);

  const payload = match[1];

  if (!payload) {
    states.delete(userId);
    return bot.sendMessage(chatId, '👋 Добро пожаловать', mainMenu());
  }

  if (payload.startsWith('deal_')) {
    const dealId = payload.replace('deal_', '');
    const deal = deals.get(dealId);

    if (!deal)
      return bot.sendMessage(chatId, '❌ Сделка не найдена');

    if (deal.status !== 'pending')
      return bot.sendMessage(chatId, '❌ Сделка уже завершена');

    return bot.sendMessage(chatId,
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

// ================= CALLBACKS =================

bot.on('callback_query', async (q) => {
  const userId = q.from.id;
  const data = q.data;

  if (data.startsWith('pay_')) {
    const dealId = data.split('_')[1];
    const deal = deals.get(dealId);

    if (!deal)
      return bot.answerCallbackQuery(q.id, { text: '❌ Нет сделки', show_alert: true });

    if (deal.status !== 'pending')
      return bot.answerCallbackQuery(q.id, { text: '❌ Уже оплачено', show_alert: true });

    deal.status = 'paid';
    deal.buyer = userId;
    save();

    await bot.sendMessage(deal.seller,
      `💰 Сделка #${deal.id} оплачена.\nПередайте NFT покупателю.`);

    await bot.sendMessage(userId,
      `💳 Оплата прошла.\nПосле получения NFT подтвердите.`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: '✅ Подтвердить', callback_data: `confirm_${deal.id}` }]
          ]
        }
      });

    return bot.answerCallbackQuery(q.id);
  }

  if (data.startsWith('confirm_')) {
    const dealId = data.split('_')[1];
    const deal = deals.get(dealId);

    if (!deal)
      return bot.answerCallbackQuery(q.id, { text: '❌ Нет сделки', show_alert: true });

    if (deal.buyer !== userId)
      return bot.answerCallbackQuery(q.id, { text: '❌ Это не ваша сделка', show_alert: true });

    if (deal.status !== 'paid')
      return bot.answerCallbackQuery(q.id, { text: '❌ Оплата не подтверждена', show_alert: true });

    deal.status = 'completed';
    save();

    await bot.sendMessage(deal.seller, `✅ Сделка #${deal.id} завершена`);
    await bot.sendMessage(userId, `🎉 Готово`);

    return bot.answerCallbackQuery(q.id);
  }
});

// ================= MAIN MESSAGE HANDLER =================

bot.on('message', async (msg) => {
  if (!msg.text) return;
  if (msg.text.startsWith('/')) return;

  const userId = msg.from.id;
  const text = msg.text;

  const user = ensureUser(userId);
  const state = states.get(userId);

  // Назад
  if (text === '⬅ Назад') {
    states.delete(userId);
    return bot.sendMessage(msg.chat.id, 'Главное меню', mainMenu());
  }

  // Профиль
  if (text === '👤 Профиль') {
    states.delete(userId);
    return bot.sendMessage(msg.chat.id,
`👤 Профиль

TON: ${user.ton || '❌'}
Карта: ${user.card || '❌'}`,
profileMenu());
  }

  if (text === 'Добавить TON') {
    states.set(userId, { step: 'add_ton' });
    return bot.sendMessage(msg.chat.id, 'Введите TON кошелёк:');
  }

  if (text === 'Добавить карту') {
    states.set(userId, { step: 'add_card' });
    return bot.sendMessage(msg.chat.id, 'Введите номер карты:');
  }

  if (text === '➕ Создать сделку') {
    states.set(userId, { step: 'currency' });
    return bot.sendMessage(msg.chat.id, 'Выберите валюту:', currencyMenu());
  }

  // ===== FSM =====

  if (!state) return;

  if (state.step === 'add_ton') {
    user.ton = text;
    states.delete(userId);
    save();
    return bot.sendMessage(msg.chat.id, '✅ TON сохранён', mainMenu());
  }

  if (state.step === 'add_card') {
    user.card = text;
    states.delete(userId);
    save();
    return bot.sendMessage(msg.chat.id, '✅ Карта сохранена', mainMenu());
  }

  if (state.step === 'currency') {
    const currency = text.toUpperCase();
    const cardCurrencies = ['USD', 'RUB', 'EUR', 'UAH'];

    if (currency === 'TON' && !user.ton)
      return bot.sendMessage(msg.chat.id, '❌ Добавьте TON в профиле');

    if (cardCurrencies.includes(currency) && !user.card)
      return bot.sendMessage(msg.chat.id, '❌ Добавьте карту в профиле');

    state.currency = currency;
    state.step = 'amount';
    return bot.sendMessage(msg.chat.id, 'Введите сумму:');
  }

  if (state.step === 'amount') {
    const amount = parseFloat(text);
    if (isNaN(amount) || amount <= 0)
      return bot.sendMessage(msg.chat.id, '❌ Некорректная сумма');

    state.amount = amount;
    state.step = 'description';
    return bot.sendMessage(msg.chat.id, 'Введите описание:');
  }

  if (state.step === 'description') {
    state.description = text;
    state.step = 'nft';
    return bot.sendMessage(msg.chat.id, 'Отправьте ссылку на NFT:');
  }

  if (state.step === 'nft') {
    const dealId = id();
    const me = await bot.getMe();

    deals.set(dealId, {
      id: dealId,
      seller: userId,
      currency: state.currency,
      amount: state.amount,
      description: state.description,
      nft: text,
      status: 'pending'
    });

    states.delete(userId);
    save();

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