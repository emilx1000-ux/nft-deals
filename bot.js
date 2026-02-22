require('dotenv').config()
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');
const http = require('http');

// ===== SERVER (для Render) =====
http.createServer((req, res) => {
    res.writeHead(200);
    res.end('Bot is running');
}).listen(process.env.PORT || 10000);

// ===== CONFIG =====
// вставь токен
const supportUsername = 'snkeeokro';
let adminEnabled = true; // Включение/выключение админки
const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

let botUsername;
bot.getMe().then(me => {
    botUsername = me.username;
    console.log('🤖 Bot username:', botUsername);
});

// ===== DATA =====
let deals = new Map();
let completedDeals = new Map();
let userBalances = new Map();
let userSessions = new Map();
let userWallets = new Map();
let userCards = new Map();

const DATA_FILE = path.join(__dirname, 'data.json');

// ===== LOAD =====
function loadData() {
    if (!fs.existsSync(DATA_FILE)) return;
    const data = JSON.parse(fs.readFileSync(DATA_FILE));
    deals = new Map(data.deals || []);
    completedDeals = new Map(data.completedDeals || []);
    userBalances = new Map(data.userBalances || []);
    userWallets = new Map(data.userWallets || []);
    userCards = new Map(data.userCards || []);
}

// ===== SAVE =====
function saveData() {
    const data = {
        deals: [...deals],
        completedDeals: [...completedDeals],
        userBalances: [...userBalances],
        userWallets: [...userWallets],
        userCards: [...userCards]
    };
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

loadData();

// ===== UTILS =====
function generateDealId() {
    return 'RNF' + Math.random().toString(36).substring(2, 8).toUpperCase();
}

function getDealLink(dealId) {
    return `https://t.me/${botUsername}?start=deal_${dealId}`;
}

function mainMenu() {
    return {
        reply_markup: {
            keyboard: [
                ['➕ Создать сделку', '📋 Мои сделки'],
                ['👤 Профиль', '🆘 Поддержка']
            ],
            resize_keyboard: true
        }
    };
}

// ===== CURRENCY MENU =====
function currencyMenu(userId) {
    const buttons = [];
    if (userWallets.has(userId)) buttons.push([{ text: '💎 TON', callback_data: 'currency_ton' }]);
    const card = userCards.get(userId);
    if (card) {
        buttons.push([{ text: 'RUB', callback_data: 'currency_rub' }]);
        buttons.push([{ text: 'USD', callback_data: 'currency_usd' }]);
        buttons.push([{ text: 'EUR', callback_data: 'currency_eur' }]);
    }
    return { reply_markup: { inline_keyboard: buttons } };
}

// ===== START =====
// ===== START =====
bot.onText(/\/start(?: deal_(.+))?/, (msg, match) => {
    const chatId = msg.chat.id;
    const dealId = match?.[1];

    // Если обычный старт без ссылки сделки
    if (!dealId) {
        return bot.sendMessage(
            chatId,
`Добро пожаловать в – надежный P2P-гарант

Покупайте и продавайте всё, что угодно – безопасно!
От Telegram-подарков и NFT до токенов и фиата – сделки проходят легко и без риска.

1. Удобное управление кошельками
2. Безопасные сделки с гарантией

Выберите нужный раздел ниже:`,
            mainMenu()
        );
    }

    // Если переход по ссылке сделки
    const deal = deals.get(dealId);
    if (!deal || deal.status !== 'pending') {
        return bot.sendMessage(chatId, '❌ Сделка недоступна');
    }

    bot.sendMessage(
        chatId,
        `💎 Сделка #${dealId}
💰 ${deal.amount} ${deal.currency}
👤 Продавец: @${deal.sellerUsername}`,
        {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '✅ Оплатить', callback_data: `pay_${dealId}` }]
                ]
            }
        }
    );
});

// ===== PROFILE =====
bot.onText(/👤 Профиль/, (msg) => {
    const id = msg.from.id;
    bot.sendMessage(
        msg.chat.id,
        `👤 Профиль\nTON: ${userWallets.has(id) ? '✅' : '❌'}\nКарта: ${userCards.has(id) ? '✅' : '❌'}`,
        {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '💎 Привязать TON', callback_data: 'bind_ton' }],
                    [{ text: '🏦 Привязать карту', callback_data: 'bind_card' }]
                ]
            }
        }
    );
});

// ===== CREATE DEAL =====
bot.onText(/➕ Создать сделку/, (msg) => {
    const id = msg.from.id;
    if (!userWallets.has(id) && !userCards.has(id)) return bot.sendMessage(msg.chat.id, '❌ Привяжите TON или карту в профиле.');
    bot.sendMessage(msg.chat.id, 'Выберите валюту:', currencyMenu(id));
});

// ===== CALLBACK =====
bot.on('callback_query', async (q) => {
    const id = q.from.id;
    const chatId = q.message.chat.id;
    const data = q.data;

    try {
        // BIND
        if (data === 'bind_ton') { userSessions.set(id, { step: 'bind_ton' }); return bot.sendMessage(chatId, 'Введите TON адрес:'); }
        if (data === 'bind_card') { userSessions.set(id, { step: 'bind_card' }); return bot.sendMessage(chatId, 'Введите номер карты:'); }

        // SELECT CURRENCY
        if (data.startsWith('currency_')) {
            const currency = data.split('_')[1];
            userSessions.set(id, { step: 'amount', currency });
            return bot.sendMessage(chatId, 'Введите сумму:');
        }

        // PAY
        if (data.startsWith('pay_')) {
            const dealId = data.split('_')[1];
            const deal = deals.get(dealId);
            if (!deal || deal.status !== 'pending') return bot.answerCallbackQuery(q.id, '❌ Сделка недоступна');

            if (!adminEnabled) return bot.answerCallbackQuery(q.id, '❌ Покупатель не оплатил (админка отключена)');

            deal.status = 'paid';
            deal.buyerId = id;
            deal.buyerUsername = q.from.username || 'no_username';
            deals.set(dealId, deal);
            saveData();

            await bot.sendMessage(
                deal.sellerId,
                `💰 Сделка #${dealId} оплачена!\n👤 Покупатель: @${deal.buyerUsername}\n💰 ${deal.amount} ${deal.currency}\n📌 Отправьте NFT в поддержку @${supportUsername}`
            );

            await bot.sendMessage(
                deal.buyerId,
                `⏳ Ожидайте передачу NFT.\nПосле получения нажмите кнопку ниже.`,
                { reply_markup: { inline_keyboard: [[{ text: '✅ Подтвердить получение NFT', callback_data: `confirm_${dealId}` }]] } }
            );

            return bot.editMessageText('✅ Оплата отправлена продавцу', { chat_id: chatId, message_id: q.message.message_id });
        }

        // CONFIRM
        if (data.startsWith('confirm_')) {
            const dealId = data.split('_')[1];
            const deal = deals.get(dealId);
            if (!deal || deal.status !== 'paid') return bot.answerCallbackQuery(q.id, '❌ Сделка недоступна');
            if (deal.buyerId !== id) return bot.answerCallbackQuery(q.id, '❌ Это не ваша сделка');

            deal.status = 'completed';
            completedDeals.set(dealId, deal);
            deals.delete(dealId);

            const currentBalance = userBalances.get(deal.sellerId) || 0;
            userBalances.set(deal.sellerId, currentBalance + deal.amount);

            saveData();

            await bot.sendMessage(
                deal.sellerId,
                `✅ Сделка #${dealId} завершена!\n💰 ${deal.amount} ${deal.currency} зачислены.`
            );

            return bot.editMessageText(`✅ Вы подтвердили получение NFT\nСделка #${dealId} завершена.`, { chat_id: chatId, message_id: q.message.message_id });
        }

    } catch (err) { console.log(err); }

    bot.answerCallbackQuery(q.id);
});

// ===== MESSAGE =====
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const text = msg.text;

    if (!text) return;

    const session = userSessions.get(userId);
    if (!session) return;

    // ===== ВВОД СУММЫ =====
    if (session.step === 'waiting_amount') {
        const amount = parseFloat(text);

        if (isNaN(amount) || amount <= 0) {
            return bot.sendMessage(chatId, '❌ Введите корректную сумму');
        }

        session.amount = amount;
        session.step = 'waiting_description';
        userSessions.set(userId, session);

        return bot.sendMessage(chatId, '📝 Введите описание сделки:');
    }

    // ===== ВВОД ОПИСАНИЯ =====
    if (session.step === 'waiting_description') {
        if (text.length < 3) {
            return bot.sendMessage(chatId, '❌ Описание слишком короткое');
        }

        session.description = text;
        session.step = 'waiting_nft';
        userSessions.set(userId, session);

        return bot.sendMessage(chatId, '🔗 Отправьте ссылку на NFT:');
    }

    // ===== ВВОД NFT =====
    if (session.step === 'waiting_nft') {
        if (!text.includes('http')) {
            return bot.sendMessage(chatId, '❌ Отправьте корректную ссылку');
        }

        session.nftLink = text;

        const dealId = generateDealId();

        const deal = {
            id: dealId,
            sellerId: userId,
            sellerUsername: msg.from.username || 'no_username',
            amount: session.amount,
            currency: session.currency,
            description: session.description,
            nftLink: session.nftLink,
            status: 'pending',
            createdAt: new Date().toISOString()
        };

        deals.set(dealId, deal);
        saveData();

        const dealLink = getDealLink(dealId);

        userSessions.delete(userId);

        return bot.sendMessage(
            chatId,
`✅ Сделка создана!

#${dealId}

💰 ${deal.amount} ${deal.currency}
📝 ${deal.description}
🔗 ${deal.nftLink}

📎 Ссылка для покупателя:
${dealLink}`,
            mainMenu()
        );
    }
});


process.on('SIGINT', () => { saveData(); process.exit(); });
console.log('✅ Bot started');