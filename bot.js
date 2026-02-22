require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');
const http = require('http');

const PORT = process.env.PORT || 10000;
http.createServer((req, res) => res.end('Bot is running')).listen(PORT);
const BOT_TOKEN = process.env.BOT_TOKEN;

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
let botUsername;

bot.getMe().then(me => {
  botUsername = me.username;
  console.log('🤖 Bot username:', botUsername);
});

// Сервер для Render
http.createServer((req, res) => {
  res.writeHead(200);
  res.end('Bot is running');
}).listen(PORT, () => console.log(`Server listening on port ${PORT}`));

// ===== DATA =====
const DATA_FILE = path.join(__dirname, 'data.json');
let deals = new Map();
let userSessions = new Map();
let userWallets = new Map();
let userCards = new Map();

function loadData() {
  if (!fs.existsSync(DATA_FILE)) return;
  const data = JSON.parse(fs.readFileSync(DATA_FILE));
  deals = new Map(data.deals || []);
  userWallets = new Map(data.userWallets || []);
  userCards = new Map(data.userCards || []);
}

function saveData() {
  const data = {
    deals: [...deals],
    userWallets: [...userWallets],
    userCards: [...userCards],
  };
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

loadData();

// ===== HELPERS =====
function generateDealId() {
  return 'RNF' + Math.random().toString(36).substring(2, 8).toUpperCase();
}

function mainMenu() {
  return { reply_markup: { keyboard: [['➕ Создать сделку'], ['👤 Профиль']], resize_keyboard: true } };
}

function getDealLink(dealId) {
  return "https://t.me/${botUsername}?start=deal_${dealId};"
}

// ===== CREATE DEAL =====
bot.onText(/➕ Создать сделку/, (msg) => {
  const userId = msg.from.id;
  if (!userWallets.has(userId) && !userCards.has(userId)) return bot.sendMessage(msg.chat.id, '❌ Привяжите TON или карту');
  userSessions.set(userId, { step: 'waiting_amount', currency: 'USD' }); // Простая валюта
  bot.sendMessage(msg.chat.id, 'Введите сумму:');
});

// ===== MESSAGES =====
bot.on('message', (msg) => {
  const userId = msg.from.id;
  const chatId = msg.chat.id;
  const text = msg.text;
  if (!text) return;

  const session = userSessions.get(userId);
  if (!session) return;

  if (session.step === 'waiting_amount') {
    const amount = parseFloat(text);
    if (isNaN(amount) || amount <= 0) return bot.sendMessage(chatId, '❌ Введите корректную сумму');
    session.amount = amount;
    session.step = 'waiting_description';
    return bot.sendMessage(chatId, 'Введите описание сделки:');
  }

  if (session.step === 'waiting_description') {
    if (text.length < 3) return bot.sendMessage(chatId, '❌ Слишком короткое описание');
    session.description = text;
    session.step = 'waiting_nft';
    return bot.sendMessage(chatId, 'Отправьте ссылку на NFT:');
  }

  if (session.step === 'waiting_nft') {
    if (!text.includes('http')) return bot.sendMessage(chatId, '❌ Некорректная ссылка');
    session.nftLink = text;

    const dealId = generateDealId();
    const deal = {
      id: dealId,
      sellerId: userId,
      amount: session.amount,
      description: session.description,
      nftLink: session.nftLink,
      status: 'pending',
    };

    deals.set(dealId, deal);
    saveData();
    userSessions.delete(userId);

    bot.sendMessage(
  chatId,
  `✅ Сделка создана!
#${dealId}
💰 ${deal.amount}
📝 ${deal.description}
🔗 ${deal.nftLink}
Ссылка для покупателя: ${getDealLink(dealId)}`,
  mainMenu()
);  }
});

// ===== SIGINT =====
process.on('SIGINT', () => { saveData(); process.exit(); });

console.log('✅ Bot started');