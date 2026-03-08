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
  // LID <-> phone mapping cache
  private lidToPhone = new Map<string, string>();
  private phoneToLid = new Map<string, string>();

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
          // Pre-build LID mapping for known phones
          this.prefetchLidMappings().catch(err =>
            console.error('[WA] Error prefetching LID mappings:', err)
          );
        }
      });

      // Save credentials on update
      this.socket.ev.on('creds.update', saveCreds);

      // Listen for phone number share events (LID -> phone mapping)
      this.socket.ev.on('chats.phoneNumberShare', (data: { lid: string; jid: string }) => {
        const lidId = data.lid.split('@')[0];
        const phone = data.jid.split('@')[0].split(':')[0];
        this.lidToPhone.set(lidId, phone);
        this.phoneToLid.set(phone, lidId);
        console.log(`[WA] phoneNumberShare: LID ${lidId} -> phone ${phone}`);
      });

      // Handle incoming messages
      this.socket.ev.on('messages.upsert', async ({ messages, type }: any) => {
        if (type !== 'notify') return;

        for (const msg of messages) {
          if (msg.key.fromMe) continue;
          if (!msg.message) continue;

          const rawJid = msg.key.remoteJid || '';
          const text =
            msg.message.conversation ||
            msg.message.extendedTextMessage?.text ||
            msg.message.buttonsResponseMessage?.selectedButtonId ||
            '';

          // Resolve phone number — LID JIDs need lookup
          let phone = jidToPhone(rawJid);
          const isLid = rawJid.endsWith('@lid');

          if (isLid) {
            const cached = this.lidToPhone.get(phone);
            if (cached) {
              phone = cached;
            } else {
              // Try to resolve via onWhatsApp reverse lookup is not possible,
              // so we log and skip — admin must use phone-format JIDs
              console.log(`[WA incoming] LID "${rawJid}" — no phone mapping cached, attempting resolve...`);
              const resolved = await this.resolveLidToPhone(rawJid);
              if (resolved) {
                phone = resolved;
              } else {
                console.log(`[WA incoming] Could not resolve LID "${rawJid}" to phone. Skipping.`);
                continue;
              }
            }
          }

          console.log(`[WA incoming] rawJid="${rawJid}" phone="${phone}" text="${text}"`);

          if (!text || !phone) continue;

          this.lastReceived = { phone, text, timestamp: new Date().toISOString() };
          await logMessage('IN', phone, text);

          try {
            await handleIncomingMessage(phone, text, rawJid);
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

  /**
   * Pre-fetch LID mappings for all known phone numbers on connect.
   */
  private async prefetchLidMappings(): Promise<void> {
    const { prisma } = await import('../lib/prisma.js');
    const students = await prisma.student.findMany({
      select: { parent1Phone: true, parent2Phone: true },
    });
    const phones = new Set<string>();
    for (const s of students) {
      if (s.parent1Phone) phones.add(s.parent1Phone);
      if (s.parent2Phone) phones.add(s.parent2Phone);
    }
    const teachers = await prisma.teacher.findMany({ select: { phone: true } });
    for (const t of teachers) {
      if (t.phone) phones.add(t.phone);
    }

    if (phones.size === 0 || !this.socket) return;

    const phoneArray = [...phones];
    console.log(`[WA] Prefetching LID mappings for ${phoneArray.length} phones...`);
    try {
      const results = await this.socket.onWhatsApp(...phoneArray);
      if (results) {
        for (const r of results) {
          if (r.lid) {
            const lidId = typeof r.lid === 'string'
              ? r.lid.split('@')[0]
              : String(r.lid);
            const rPhone = r.jid.split('@')[0].split(':')[0];
            this.lidToPhone.set(lidId, rPhone);
            this.phoneToLid.set(rPhone, lidId);
          }
        }
        console.log(`[WA] Prefetched ${this.lidToPhone.size} LID mappings`);
      }
    } catch (err) {
      console.error('[WA] prefetchLidMappings error:', err);
    }
  }

  /**
   * Resolve a LID to a phone number by querying contacts in the DB
   * and using onWhatsApp to find which one maps to this LID.
   */
  private async resolveLidToPhone(lidJid: string): Promise<string | null> {
    try {
      const { prisma } = await import('../lib/prisma.js');
      // Get all unique parent phones from students
      const students = await prisma.student.findMany({
        select: { parent1Phone: true, parent2Phone: true },
      });
      const phones = new Set<string>();
      for (const s of students) {
        if (s.parent1Phone) phones.add(s.parent1Phone);
        if (s.parent2Phone) phones.add(s.parent2Phone);
      }
      // Also add teacher phones
      const teachers = await prisma.teacher.findMany({ select: { phone: true } });
      for (const t of teachers) {
        if (t.phone) phones.add(t.phone);
      }

      // Query WhatsApp for all known phones to build LID mapping
      if (this.socket && phones.size > 0) {
        const phoneArray = [...phones];
        console.log(`[WA] Resolving LID: querying ${phoneArray.length} known phones...`);
        const results = await this.socket.onWhatsApp(...phoneArray);
        if (results) {
          const lidId = lidJid.split('@')[0];
          for (const r of results) {
            if (r.lid) {
              const rLidId = typeof r.lid === 'string' ? r.lid.split('@')[0] : r.lid.toString?.();
              const rPhone = r.jid.split('@')[0].split(':')[0];
              // Cache the mapping
              this.lidToPhone.set(rLidId, rPhone);
              this.phoneToLid.set(rPhone, rLidId);
              console.log(`[WA] Mapped LID ${rLidId} -> phone ${rPhone}`);
              if (rLidId === lidId) {
                return rPhone;
              }
            }
          }
        }
      }
    } catch (err) {
      console.error('[WA] Error resolving LID to phone:', err);
    }
    return null;
  }

  /**
   * Resolve a phone number (972...) to the correct JID for sending.
   * Returns LID JID if known, otherwise falls back to standard JID.
   */
  resolveJidForSend(phone: string): string {
    const lidId = this.phoneToLid.get(phone);
    if (lidId) {
      return `${lidId}@lid`;
    }
    return `${phone}@s.whatsapp.net`;
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
