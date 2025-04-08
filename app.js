require('dotenv').config();

const axios = require('axios');
const crypto = require('crypto');
const TelegramBot = require('node-telegram-bot-api');
const cron = require('node-cron');

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const BYBIT_API_KEY = process.env.BYBIT_API_KEY;
const BYBIT_API_SECRET = process.env.BYBIT_API_SECRET;
const CRON_SCHEDULE = '*/20 * * * * *';

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
let activeOrders = {};
let confirmationQueue = {};
let p2pEnabled = false;

async function getP2POrders() {
  if (!p2pEnabled) return;

  const endpoint = '/v5/p2p/order/pending/simplifyList';
  const url = `https://api.bybit.com${endpoint}`;

  const body = {
    status: null,
    side: null,
    page: 1,
    size: 10,
  };

  const timestamp = Date.now().toString();
  const recvWindow = '5000';
  const signPayload = timestamp + BYBIT_API_KEY + recvWindow + JSON.stringify(body);
  const sign = crypto.createHmac('sha256', BYBIT_API_SECRET).update(signPayload).digest('hex');

  try {
    console.log(`[INFO] Sending request to Bybit: ${url} with body: ${JSON.stringify(body)}`);
    const response = await axios.post(url, body, {
      headers: {
        'X-BAPI-SIGN': sign,
        'X-BAPI-API-KEY': BYBIT_API_KEY,
        'X-BAPI-TIMESTAMP': timestamp,
        'X-BAPI-RECV-WINDOW': recvWindow,
        'Content-Type': 'application/json',
      },
    });

    console.log(`[INFO] Received response from Bybit: ${JSON.stringify(response.data)}`);
    const orders = response.data.result?.items || [];

    for (const order of orders) {
      const existing = activeOrders[order.id];

      if (!existing) {
        activeOrders[order.id] = order;
        console.log(`[INFO] New order detected: ${order.id}`);
        sendTelegramMessage(`🔔 Новая сделка: ${formatOrder(order)}`);
      } else if (existing.status !== order.status) {
        activeOrders[order.id] = order;
        console.log(`[INFO] Order status changed: ${order.id}, new status: ${order.status}`);
        sendTelegramMessage(`🔄 Статус сделки ${order.id} изменился: ${order.status}`);
      }

      if (order.status === 20 && !confirmationQueue[order.id]) {
        confirmationQueue[order.id] = true;
        console.log(`[INFO] Order ${order.id} added to confirmation queue.`);
        askForConfirmation(order.id);
      }

      if (order.selfUnreadMsgCount !== '0') {
        console.log(`[INFO] New message for order ${order.id}.`);
        sendTelegramMessage(`💬 Новое сообщение по сделке ${order.id}`);
      }
    }
    
    for (const orderId in activeOrders) {
      const existingOrder = orders.find(order => order.id === orderId);
      if (!existingOrder) {
        console.log(`[INFO] Order ${orderId} not found in current orders. Fetching details.`);
        const orderDetails = await fetchOrderDetails(orderId);

        if (orderDetails && orderDetails.status === 50) {
          console.log(`[INFO] Order ${orderId} completed successfully.`);
          sendTelegramMessage(`✅ Сделка ${orderId} успешно завершена!\n${formatOrder(orderDetails)}`);
        } else if (orderDetails && orderDetails.status === 40) {
          console.log(`[INFO] Order ${orderId} has been canceled.`);
          sendTelegramMessage(`❌ Сделка ${orderId} была отменена.`);
        } else if (orderDetails && orderDetails.status === 30) {
          console.log(`[INFO] Order ${orderId} has been appealed.`);
          sendTelegramMessage(`⚠️ Открыт спор по сделке ${orderId}!!!`);
        }


        delete activeOrders[orderId];
      }
    }
  } catch (err) {
    console.error(`[ERROR] Error fetching P2P orders from Bybit: ${err.message}`);
  }
}

async function fetchOrderDetails(orderId) {
  const endpoint = '/v5/p2p/order/info';
  const url = `https://api.bybit.com${endpoint}`;

  const body = { orderId };

  const timestamp = Date.now().toString();
  const recvWindow = '5000';
  const signPayload = timestamp + BYBIT_API_KEY + recvWindow + JSON.stringify(body);
  const sign = crypto.createHmac('sha256', BYBIT_API_SECRET).update(signPayload).digest('hex');

  try {
    console.log(`[INFO] Fetching details for order ${orderId}`);
    const response = await axios.post(url, body, {
      headers: {
        'X-BAPI-SIGN': sign,
        'X-BAPI-API-KEY': BYBIT_API_KEY,
        'X-BAPI-TIMESTAMP': timestamp,
        'X-BAPI-RECV-WINDOW': recvWindow,
        'Content-Type': 'application/json',
      },
    });

    if (response.data.ret_code === 0) {
      console.log(`[INFO] Successfully fetched details for order ${orderId}`);
      return response.data.result;
    } else {
      console.error(`[ERROR] Failed to fetch details for order ${orderId}: ${response.data.ret_msg}`);
      return null;
    }
  } catch (err) {
    console.error(`[ERROR] Error fetching details for order ${orderId}: ${err.message}`);
    return null;
  }
}

function formatOrder(order) {
  return `ID: ${order.id}\nСумма: ${order.amount} ${order.currencyId}\nТокен: ${order.tokenId} (${order.notifyTokenQuantity})\nПокупатель: ${order.buyerRealName}\nПродавец: ${order.sellerRealName}\nЦена: ${order.price}`;
}

function sendTelegramMessage(text, extra = {}) {
  console.log(`[INFO] Sending message to Telegram: ${text}`);
  return bot.sendMessage(TELEGRAM_CHAT_ID, text, extra)
    .then(() => console.log(`[INFO] Message sent to Telegram successfully.`))
    .catch(err => console.error(`[ERROR] Error sending message to Telegram: ${err.message}`));
}

function askForConfirmation(orderId) {
  bot.sendMessage(TELEGRAM_CHAT_ID, `❗ Подтвердите закрытие сделки ${orderId}?`, {
    reply_markup: {
      inline_keyboard: [[
        { text: 'Подтвердить', callback_data: `confirm1_${orderId}` },
        { text: 'Нет', callback_data: `cancel_${orderId}` }
      ]]
    }
  });
}

bot.on('callback_query', (query) => {
  const { data } = query;
  const [action, orderId] = data.split('_');

  if (action === 'confirm1') {
    bot.sendMessage(TELEGRAM_CHAT_ID, `❓ Вы уверены, что хотите подтвердить сделку ${orderId}?`, {
      reply_markup: {
        inline_keyboard: [[
          { text: 'Да', callback_data: `confirm2_${orderId}` },
          { text: 'Нет', callback_data: `cancel_${orderId}` }
        ]]
      }
    });
  } else if (action === 'confirm2') {
    confirmOrder(orderId);
  } else if (action === 'cancel') {
    delete confirmationQueue[orderId];
    bot.sendMessage(TELEGRAM_CHAT_ID, `❌ Подтверждение отменено для сделки ${orderId}`);
  }
});

async function confirmOrder(orderId) {
  const endpoint = '/v5/p2p/order/finish';
  const url = `https://api.bybit.com${endpoint}`;

  const body = { orderId };

  const timestamp = Date.now().toString();
  const recvWindow = '5000';
  const signPayload = timestamp + BYBIT_API_KEY + recvWindow + JSON.stringify(body);
  const sign = crypto.createHmac('sha256', BYBIT_API_SECRET).update(signPayload).digest('hex');

  try {
    console.log(`[INFO] Sending confirmation request to Bybit: ${url} with body: ${JSON.stringify(body)}`);
    const response = await axios.post(url, body, {
      headers: {
        'X-BAPI-SIGN': sign,
        'X-BAPI-API-KEY': BYBIT_API_KEY,
        'X-BAPI-TIMESTAMP': timestamp,
        'X-BAPI-RECV-WINDOW': recvWindow,
        'Content-Type': 'application/json',
      },
    });

    console.log(`[INFO] Received response from Bybit for confirmation: ${JSON.stringify(response.data)}`);
    if (response.data.ret_code === 0) {
      console.log(`[INFO] Order ${orderId} confirmed successfully.`);
      sendTelegramMessage(`✅ Успешное подтверждение сделки ${orderId}`);
    } else {
      console.error(`[ERROR] Error confirming order ${orderId}: ${response.data.ret_msg}`);
      sendTelegramMessage(`⚠️ Ошибка подтверждения сделки ${orderId}: ${response.data.ret_msg}`);
    }
  } catch (err) {
    console.error(`[ERROR] Error confirming order ${orderId}: ${err.message}`);
    sendTelegramMessage(`⚠️ Ошибка при подтверждении сделки ${orderId}: ${err.message}`);
  } finally {
    delete confirmationQueue[orderId];
  }
}

cron.schedule(CRON_SCHEDULE, getP2POrders);

bot.on('message', (msg) => {
  const text = msg.text?.toLowerCase();

  if (text === '/off') {
    p2pEnabled = false;
    sendTelegramMessage('📴 Мониторинг P2P отключён.');
  } else if (text === '/on') {
    p2pEnabled = true;
    sendTelegramMessage('✅ Мониторинг P2P включён.');
  } else if (text === '/status') {
    sendTelegramMessage(p2pEnabled ? '✅ Мониторинг P2P включён.' : '📴 Мониторинг P2P отключён.');
  } else if (text === '/help') {
    sendTelegramMessage(`ℹ️ Возможности бота:

/on — включить мониторинг сделок
/off — выключить мониторинг сделок
/help — показать список команд
/status - показать статус мониторинга

Бот отслеживает:
• Новые P2P-сделки
• Изменения статуса сделки
• Новые сообщения по сделке
• Ожидающие подтверждения сделки с двойной проверкой

Используйте кнопки для подтверждения завершения сделки.`);
  }
});

console.log('P2P Telegram бот запущен.');
