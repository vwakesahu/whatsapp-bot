import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import qrcode from 'qrcode-terminal';

export type MessageHandler = (message: pkg.Message) => Promise<void>;

let client: pkg.Client;
let messageHandler: MessageHandler;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;
const BASE_DELAY_MS = 5_000; // 5s, doubles each attempt up to ~2.5 min

function getReconnectDelay(): number {
  const delay = Math.min(BASE_DELAY_MS * 2 ** reconnectAttempts, 150_000);
  return delay;
}

async function reconnect(): Promise<void> {
  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    console.error(`[whatsapp] Max reconnect attempts (${MAX_RECONNECT_ATTEMPTS}) reached. Exiting — PM2 will restart.`);
    process.exit(1);
  }

  reconnectAttempts++;
  const delay = getReconnectDelay();
  console.log(`[whatsapp] Reconnecting in ${delay / 1000}s (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`);

  await new Promise(resolve => setTimeout(resolve, delay));

  try {
    await client.destroy().catch(() => {}); // clean up old session
    client = createClient(messageHandler);
    await client.initialize();
  } catch (error) {
    console.error('[whatsapp] Reconnect failed:', error);
    await reconnect();
  }
}

function createClient(onMessage: MessageHandler): pkg.Client {
  const isRaspberryPi = process.platform === 'linux' && process.arch === 'arm64';

  const newClient = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
      headless: true,
      ...(isRaspberryPi && { executablePath: '/usr/bin/chromium-browser' }),
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        ...(isRaspberryPi ? ['--disable-gpu', '--disable-software-rasterizer'] : []),
      ],
    },
  });

  newClient.on('qr', (qr: string) => {
    console.log('[whatsapp] Scan this QR code with your phone:');
    qrcode.generate(qr, { small: true });
  });

  newClient.on('ready', () => {
    console.log('[whatsapp] Client is ready!');
    reconnectAttempts = 0; // reset on successful connection
  });

  newClient.on('authenticated', () => {
    console.log('[whatsapp] Authenticated successfully');
  });

  newClient.on('auth_failure', (msg: string) => {
    console.error('[whatsapp] Auth failure:', msg);
  });

  newClient.on('disconnected', (reason: string) => {
    console.warn('[whatsapp] Disconnected:', reason);
    reconnect();
  });

  newClient.on('message', async (message: pkg.Message) => {
    try {
      if (message.from === 'status@broadcast' || message.isStatus) return;
      await onMessage(message);
    } catch (error) {
      console.error('[whatsapp] Error handling message:', error);
    }
  });

  return newClient;
}

export function initWhatsApp(onMessage: MessageHandler): pkg.Client {
  messageHandler = onMessage;
  client = createClient(onMessage);
  return client;
}

export function getClient(): pkg.Client {
  if (!client) throw new Error('WhatsApp client not initialized');
  return client;
}
