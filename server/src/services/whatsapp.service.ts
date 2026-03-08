import QRCode from 'qrcode';
import { usePrismaAuthState } from './whatsapp-auth-store';
import { handleIncomingMessage } from './bot.service';
import { getIO } from '../socket';
import { jidToPhone } from '../utils/phone';
import { logMessage } from './notification.service';

type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'qr';

class WhatsAppService {
  private socket: any = null;
  private status: ConnectionStatus = 'disconnected';
  private currentQR: string | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private lastReceived: { phone: string; text: string; timestamp: string } | null = null;

  async connect(): Promise<void> {
    try {
      this.status = 'connecting';
      this.emitStatus();

      const baileys = await import('baileys');
      const makeWASocket = baileys.default;
      const { DisconnectReason, fetchLatestBaileysVersion, makeCacheableSignalKeyStore } = baileys;

      const { state, saveCreds } = await usePrismaAuthState();
      const { version } = await fetchLatestBaileysVersion();

      this.socket = makeWASocket({
        version,
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, undefined as any),
        },
        printQRInTerminal: true,
        generateHighQualityLinkPreview: false,
      });

      // Handle connection updates
      this.socket.ev.on('connection.update', async (update: any) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          this.currentQR = await QRCode.toDataURL(qr);
          this.status = 'qr';
          this.emitStatus();
          this.emitQR();
        }

        if (connection === 'close') {
          this.currentQR = null;
          const statusCode = lastDisconnect?.error?.output?.statusCode;
          const errorMsg = lastDisconnect?.error?.message || 'unknown';
          console.log(`WhatsApp connection closed — statusCode=${statusCode}, error="${errorMsg}"`);

          if (statusCode === DisconnectReason.loggedOut) {
            console.log('WhatsApp logged out, clearing session...');
            const { prisma } = await import('../lib/prisma.js');
            await prisma.whatsappSession.deleteMany();
            this.status = 'disconnected';
            this.emitStatus();
          } else if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            const delay = 3000 * this.reconnectAttempts;
            console.log(`WhatsApp reconnecting... attempt ${this.reconnectAttempts} in ${delay}ms`);
            this.status = 'connecting';
            this.emitStatus();
            setTimeout(() => this.connect(), delay);
          } else {
            this.status = 'disconnected';
            this.emitStatus();
            this.emitError(`החיבור נכשל לאחר ${this.maxReconnectAttempts} ניסיונות (שגיאה: ${errorMsg}). נסה "נתק וחבר מחדש".`);
            console.log('WhatsApp max reconnect attempts reached');
          }
        }

        if (connection === 'open') {
          this.status = 'connected';
          this.currentQR = null;
          this.reconnectAttempts = 0;
          this.emitStatus();
          console.log('WhatsApp connected successfully');
        }
      });

      // Save credentials on update
      this.socket.ev.on('creds.update', saveCreds);

      // Handle incoming messages
      this.socket.ev.on('messages.upsert', async ({ messages, type }: any) => {
        if (type !== 'notify') return;

        for (const msg of messages) {
          if (msg.key.fromMe) continue;
          if (!msg.message) continue;

          const rawJid = msg.key.remoteJid || '';
          const phone = jidToPhone(rawJid);
          const text =
            msg.message.conversation ||
            msg.message.extendedTextMessage?.text ||
            msg.message.buttonsResponseMessage?.selectedButtonId ||
            '';

          console.log(`[WA incoming] rawJid="${rawJid}" phone="${phone}" text="${text}"`);

          if (!text || !phone) continue;

          this.lastReceived = { phone, text, timestamp: new Date().toISOString() };
          await logMessage('IN', phone, text);

          try {
            await handleIncomingMessage(phone, text);
          } catch (error) {
            console.error('Error handling message:', error);
          }
        }
      });
    } catch (error) {
      console.error('WhatsApp connection error:', error);
      this.status = 'disconnected';
      this.emitStatus();
      this.emitError(error instanceof Error ? error.message : 'שגיאה בחיבור לוואטסאפ');
    }
  }

  async sendMessage(jid: string, text: string): Promise<void> {
    if (!this.socket || this.status !== 'connected') {
      throw new Error('WhatsApp not connected');
    }
    await this.socket.sendMessage(jid, { text });
  }

  async sendInteractiveButtons(
    jid: string,
    text: string,
    buttons: Array<{ buttonId: string; buttonText: { displayText: string } }>
  ): Promise<void> {
    if (!this.socket || this.status !== 'connected') {
      throw new Error('WhatsApp not connected');
    }
    await this.socket.sendMessage(jid, {
      text,
      buttons,
      headerType: 1,
    } as any);
  }

  async restart(): Promise<void> {
    if (this.socket) {
      this.socket.end(undefined);
      this.socket = null;
    }
    this.reconnectAttempts = 0;
    this.status = 'disconnected';
    this.currentQR = null;
    this.emitStatus();
    // Don't await connect() — it sets up event listeners and returns,
    // but Baileys continues in the background. Errors are logged.
    this.connect().catch(err => console.error('WhatsApp restart connect error:', err));
  }

  async logout(): Promise<void> {
    if (this.socket) {
      try {
        await this.socket.logout();
      } catch (e) {
        // ignore — socket may already be closed
      }
      this.socket.end(undefined);
      this.socket = null;
    }
    // Clear all auth data from DB
    const { prisma } = await import('../lib/prisma.js');
    await prisma.whatsappSession.deleteMany();
    console.log('WhatsApp session cleared from DB');
    this.reconnectAttempts = 0;
    this.status = 'disconnected';
    this.currentQR = null;
    this.emitStatus();
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }

  getQR(): string | null {
    return this.currentQR;
  }

  getLastReceivedMessage(): { phone: string; text: string; timestamp: string } | null {
    return this.lastReceived;
  }

  private emitStatus(): void {
    const io = getIO();
    if (io) {
      io.emit('whatsapp:status', { status: this.status });
    }
  }

  private emitQR(): void {
    const io = getIO();
    if (io && this.currentQR) {
      io.emit('whatsapp:qr', { qr: this.currentQR });
    }
  }

  private emitError(message: string): void {
    const io = getIO();
    if (io) {
      io.emit('whatsapp:error', { error: message });
    }
  }
}

let instance: WhatsAppService | null = null;

export function getWhatsAppService(): WhatsAppService {
  if (!instance) {
    instance = new WhatsAppService();
  }
  return instance;
}
