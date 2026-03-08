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
          const reason = lastDisconnect?.error?.output?.statusCode;

          if (reason === DisconnectReason.loggedOut) {
            this.status = 'disconnected';
            this.emitStatus();
            console.log('WhatsApp logged out, clearing session...');
          } else if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            console.log(`WhatsApp reconnecting... attempt ${this.reconnectAttempts}`);
            setTimeout(() => this.connect(), 3000 * this.reconnectAttempts);
          } else {
            this.status = 'disconnected';
            this.emitStatus();
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

          const phone = jidToPhone(msg.key.remoteJid || '');
          const text =
            msg.message.conversation ||
            msg.message.extendedTextMessage?.text ||
            msg.message.buttonsResponseMessage?.selectedButtonId ||
            '';

          if (!text || !phone) continue;

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
    await this.connect();
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }

  getQR(): string | null {
    return this.currentQR;
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
}

let instance: WhatsAppService | null = null;

export function getWhatsAppService(): WhatsAppService {
  if (!instance) {
    instance = new WhatsAppService();
  }
  return instance;
}
