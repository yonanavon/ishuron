import QRCode from 'qrcode';
import { usePrismaAuthState } from './whatsapp-auth-store';
import { handleIncomingMessage } from './bot.service';
import { getIO } from '../socket';
import { jidToPhone } from '../utils/phone';
import { logMessage } from './notification.service';
import { logger } from '../lib/logger';

const log = logger.child({ module: 'whatsapp' });

type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'qr';

const RECONNECT_WINDOW_MS = 10 * 60 * 1000; // 10 min
const RECONNECT_WINDOW_LIMIT = 5;
const RECONNECT_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour pause if limit hit
const SEND_MIN_GAP_MS = 1500;
const PREFETCH_CHUNK = 50;
const PREFETCH_CHUNK_GAP_MS = 2000;
const LID_NEGATIVE_TTL_MS = 5 * 60 * 1000;

class WhatsAppService {
  private socket: any = null;
  private status: ConnectionStatus = 'disconnected';
  private currentQR: string | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private recentReconnects: number[] = [];
  private cooldownUntil = 0;
  private lastReceived: { phone: string; text: string; timestamp: string } | null = null;
  // LID <-> phone mapping cache
  private lidToPhone = new Map<string, string>();
  private phoneToLid = new Map<string, string>();
  private lidNegativeCache = new Map<string, number>();
  private pendingLidResolves = new Map<string, Promise<string | null>>();
  // Global send queue — serializes outgoing sends with a minimum gap
  private sendQueue: Promise<any> = Promise.resolve();
  private lastSentAt = 0;

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
        printQRInTerminal: false,
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
          log.warn({ statusCode, errorMsg }, 'whatsapp connection closed');

          const shouldReconnect = this.shouldReconnectFor(statusCode, DisconnectReason);

          if (statusCode === DisconnectReason.loggedOut) {
            log.info('whatsapp logged out, clearing session');
            const { prisma } = await import('../lib/prisma.js');
            await prisma.whatsappSession.deleteMany();
            this.status = 'disconnected';
            this.emitStatus();
          } else if (!shouldReconnect) {
            // WhatsApp is signaling us to stop (e.g. connectionReplaced).
            // Do not auto-reconnect — requires manual restart.
            this.status = 'disconnected';
            this.emitStatus();
            this.emitError(`החיבור נסגר על ידי וואטסאפ (קוד ${statusCode}). לחץ "נתק וחבר מחדש" כדי להתחבר שוב.`);
            log.warn({ statusCode }, 'disconnect reason not auto-reconnectable');
          } else if (Date.now() < this.cooldownUntil) {
            const waitMs = this.cooldownUntil - Date.now();
            this.status = 'disconnected';
            this.emitStatus();
            this.emitError(`החיבור בקירור עקב ריבוי ניתוקים. נסה שוב בעוד כ-${Math.ceil(waitMs / 60000)} דקות.`);
            log.warn({ waitMs }, 'reconnect suppressed: in cooldown window');
          } else if (this.hitReconnectWindowLimit()) {
            this.cooldownUntil = Date.now() + RECONNECT_COOLDOWN_MS;
            this.recentReconnects = [];
            this.status = 'disconnected';
            this.emitStatus();
            this.emitError(`זוהו ניתוקים חוזרים — החיבור בקירור לשעה כדי למנוע חסימת חשבון.`);
            log.error({ cooldownUntil: this.cooldownUntil }, 'entering reconnect cooldown');
          } else if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            this.recentReconnects.push(Date.now());
            const delay = this.computeBackoffMs(this.reconnectAttempts);
            log.info({ attempt: this.reconnectAttempts, delayMs: delay }, 'whatsapp reconnecting');
            this.status = 'connecting';
            this.emitStatus();
            setTimeout(() => this.connect(), delay);
          } else {
            this.status = 'disconnected';
            this.emitStatus();
            this.emitError(`החיבור נכשל לאחר ${this.maxReconnectAttempts} ניסיונות (שגיאה: ${errorMsg}). נסה "נתק וחבר מחדש".`);
            log.error('whatsapp max reconnect attempts reached');
          }
        }

        if (connection === 'open') {
          this.status = 'connected';
          this.currentQR = null;
          this.reconnectAttempts = 0;
          this.emitStatus();
          log.info('whatsapp connected successfully');
          this.prefetchLidMappings().catch(err =>
            log.error({ err }, 'error prefetching LID mappings'),
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
        log.debug({ lidId, phone }, 'phoneNumberShare mapping');
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
              log.debug({ rawJid }, 'LID not cached, attempting resolve');
              const resolved = await this.resolveLidToPhone(rawJid);
              if (resolved) {
                phone = resolved;
              } else {
                log.warn({ rawJid }, 'could not resolve LID to phone, skipping');
                continue;
              }
            }
          }

          log.debug({ rawJid, phone, text }, 'incoming message');

          if (!text || !phone) continue;

          this.lastReceived = { phone, text, timestamp: new Date().toISOString() };
          await logMessage('IN', phone, text);

          try {
            await handleIncomingMessage(phone, text, rawJid);
          } catch (error) {
            log.error({ err: error, phone }, 'error handling message');
          }
        }
      });
    } catch (error) {
      log.error({ err: error }, 'whatsapp connection error');
      this.status = 'disconnected';
      this.emitStatus();
      this.emitError(error instanceof Error ? error.message : 'שגיאה בחיבור לוואטסאפ');
    }
  }

  /**
   * Only reconnect for benign/transient disconnects. Reasons like
   * connectionReplaced indicate WhatsApp wants us to stop — blindly
   * reconnecting looks like a rogue client and risks a ban.
   */
  private shouldReconnectFor(statusCode: number | undefined, DisconnectReason: any): boolean {
    if (!statusCode) return true;
    const reconnectable = new Set<number>([
      DisconnectReason.connectionClosed,
      DisconnectReason.connectionLost,
      DisconnectReason.timedOut,
      DisconnectReason.restartRequired,
    ].filter((v) => typeof v === 'number'));
    return reconnectable.has(statusCode);
  }

  private hitReconnectWindowLimit(): boolean {
    const cutoff = Date.now() - RECONNECT_WINDOW_MS;
    this.recentReconnects = this.recentReconnects.filter((t) => t > cutoff);
    return this.recentReconnects.length >= RECONNECT_WINDOW_LIMIT;
  }

  private computeBackoffMs(attempt: number): number {
    const base = Math.min(30_000, 2_000 * Math.pow(2, attempt - 1));
    const jitter = Math.floor(Math.random() * 1_000);
    return base + jitter;
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
    log.debug({ count: phoneArray.length, chunk: PREFETCH_CHUNK }, 'prefetching LID mappings');
    let mapped = 0;
    for (let i = 0; i < phoneArray.length; i += PREFETCH_CHUNK) {
      if (!this.socket || this.status !== 'connected') return;
      const chunk = phoneArray.slice(i, i + PREFETCH_CHUNK);
      try {
        const results = await this.socket.onWhatsApp(...chunk);
        if (results) {
          for (const r of results) {
            if (r.lid) {
              const lidId =
                typeof r.lid === 'string' ? r.lid.split('@')[0] : String(r.lid);
              const rPhone = r.jid.split('@')[0].split(':')[0];
              this.lidToPhone.set(lidId, rPhone);
              this.phoneToLid.set(rPhone, lidId);
              mapped++;
            }
          }
        }
      } catch (err) {
        log.error({ err, chunkStart: i }, 'prefetchLidMappings chunk error');
      }
      if (i + PREFETCH_CHUNK < phoneArray.length) {
        await new Promise((r) => setTimeout(r, PREFETCH_CHUNK_GAP_MS));
      }
    }
    log.info({ mapped }, 'prefetched LID mappings');
  }

  /**
   * Resolve a LID to a phone number by querying contacts in the DB
   * and using onWhatsApp to find which one maps to this LID.
   *
   * Negative-caches failed lookups for LID_NEGATIVE_TTL_MS to prevent
   * repeated bulk onWhatsApp queries (rate-limit risk), and dedupes
   * concurrent resolves for the same LID.
   */
  private async resolveLidToPhone(lidJid: string): Promise<string | null> {
    const lidId = lidJid.split('@')[0];

    const negAt = this.lidNegativeCache.get(lidId);
    if (negAt && Date.now() - negAt < LID_NEGATIVE_TTL_MS) {
      return null;
    }

    const inflight = this.pendingLidResolves.get(lidId);
    if (inflight) return inflight;

    const task = this.doResolveLidToPhone(lidJid, lidId);
    this.pendingLidResolves.set(lidId, task);
    try {
      const result = await task;
      if (result === null) {
        this.lidNegativeCache.set(lidId, Date.now());
      }
      return result;
    } finally {
      this.pendingLidResolves.delete(lidId);
    }
  }

  private async doResolveLidToPhone(lidJid: string, lidId: string): Promise<string | null> {
    try {
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

      if (!this.socket || phones.size === 0) return null;

      const phoneArray = [...phones];
      log.debug({ count: phoneArray.length }, 'resolving LID, querying known phones');
      let found: string | null = null;
      for (let i = 0; i < phoneArray.length; i += PREFETCH_CHUNK) {
        if (!this.socket) break;
        const chunk = phoneArray.slice(i, i + PREFETCH_CHUNK);
        try {
          const results = await this.socket.onWhatsApp(...chunk);
          if (results) {
            for (const r of results) {
              if (r.lid) {
                const rLidId =
                  typeof r.lid === 'string' ? r.lid.split('@')[0] : r.lid.toString?.();
                const rPhone = r.jid.split('@')[0].split(':')[0];
                this.lidToPhone.set(rLidId, rPhone);
                this.phoneToLid.set(rPhone, rLidId);
                if (rLidId === lidId) {
                  found = rPhone;
                }
              }
            }
          }
        } catch (err) {
          log.error({ err, chunkStart: i }, 'resolveLidToPhone chunk error');
        }
        if (found) return found;
        if (i + PREFETCH_CHUNK < phoneArray.length) {
          await new Promise((r) => setTimeout(r, PREFETCH_CHUNK_GAP_MS));
        }
      }
    } catch (err) {
      log.error({ err }, 'error resolving LID to phone');
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

  /**
   * Serialize all outgoing sends through a single queue with a minimum gap
   * between sends. Bursting messages (e.g. multi-guard notifications or
   * simultaneous approvals) looks bot-like to WhatsApp anti-abuse heuristics.
   */
  private enqueueSend<T>(label: string, fn: () => Promise<T>): Promise<T> {
    const task = this.sendQueue.then(async () => {
      const wait = this.lastSentAt + SEND_MIN_GAP_MS - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      try {
        return await fn();
      } finally {
        this.lastSentAt = Date.now();
      }
    });
    // Never let a rejected send poison the queue for subsequent sends.
    this.sendQueue = task.catch(() => undefined);
    log.debug({ label }, 'send queued');
    return task;
  }

  async sendMessage(jid: string, text: string): Promise<void> {
    if (!this.socket || this.status !== 'connected') {
      throw new Error('WhatsApp not connected');
    }
    await this.enqueueSend('text', () => this.socket.sendMessage(jid, { text }));
  }

  async sendInteractiveButtons(
    jid: string,
    text: string,
    buttons: Array<{ buttonId: string; buttonText: { displayText: string } }>
  ): Promise<void> {
    if (!this.socket || this.status !== 'connected') {
      throw new Error('WhatsApp not connected');
    }
    await this.enqueueSend('buttons', () =>
      this.socket.sendMessage(jid, {
        text,
        buttons,
        headerType: 1,
      } as any),
    );
  }

  async restart(): Promise<void> {
    if (this.socket) {
      this.socket.end(undefined);
      this.socket = null;
    }
    this.reconnectAttempts = 0;
    this.recentReconnects = [];
    this.cooldownUntil = 0;
    this.status = 'disconnected';
    this.currentQR = null;
    this.emitStatus();
    // Don't await connect() — it sets up event listeners and returns,
    // but Baileys continues in the background. Errors are logged.
    this.connect().catch(err => log.error({ err }, 'whatsapp restart connect error'));
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
    log.info('whatsapp session cleared from DB');
    this.reconnectAttempts = 0;
    this.recentReconnects = [];
    this.cooldownUntil = 0;
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
