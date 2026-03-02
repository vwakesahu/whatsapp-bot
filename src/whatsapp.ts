import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import qrcode from 'qrcode-terminal';

export type MessageHandler = (message: pkg.Message) => Promise<void>;

let client: pkg.Client;

export function initWhatsApp(onMessage: MessageHandler): pkg.Client {
  const isRaspberryPi = process.platform === 'linux' && process.arch === 'arm64';

  client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        ...(isRaspberryPi ? ['--disable-gpu', '--disable-software-rasterizer'] : []),
      ],
    },
  });

  client.on('qr', (qr: string) => {
    console.log('[whatsapp] Scan this QR code with your phone:');
    qrcode.generate(qr, { small: true });
  });

  client.on('ready', () => {
    console.log('[whatsapp] Client is ready!');
  });

  client.on('authenticated', () => {
    console.log('[whatsapp] Authenticated successfully');
  });

  client.on('auth_failure', (msg: string) => {
    console.error('[whatsapp] Auth failure:', msg);
  });

  client.on('disconnected', (reason: string) => {
    console.warn('[whatsapp] Disconnected:', reason);
    console.log('[whatsapp] Attempting to reconnect...');
    client.initialize();
  });

  client.on('message', async (message: pkg.Message) => {
    try {
      await onMessage(message);
    } catch (error) {
      console.error('[whatsapp] Error handling message:', error);
    }
  });

  return client;
}

export function getClient(): pkg.Client {
  if (!client) throw new Error('WhatsApp client not initialized');
  return client;
}
