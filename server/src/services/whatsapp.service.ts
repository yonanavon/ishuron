import QRCode from 'qrcode';
import { usePrismaAuthState } from './whatsapp-auth-store';
import { handleIncomingMessage } from './bot.service';
import { emitToSchool } from '../socket';
import { jidToPhone } from '../utils/phone';
import { logMessage } from './notification.service';
import { logger } from '../lib/logger';
import { prisma, runWithTenant } from '../lib/prisma';

type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'qr';

const RECONNECT_WINDOW_MS = 10 * 60 * 1000;
const RECONNECT_WINDOW_LIMIT = 5;
const RECONNECT_COOLDOWN_MS = 60 * 60 * 1000;
const SEND_MIN_GAP_MS = 1500;
const PREFETCH_CHUNK = 50;
const PREFETCH_CHUNK_GAP_MS = 2000;
const LID_NEGATIVE_TTL_MS = 5 * 60 * 1000;

export class WhatsAppService {
  private socket: any = null;
  private status: ConnectionStatus = 'disconnected';
  private currentQR: string | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private recentReconnects: number[] = [];
  private cooldownUntil = 0;
  private lastReceived: { phone: string; text: string; timestamp: string } | null = null;
  private lidToPhone = new Map<string, string>();
  private phoneToLid = new Map<string, string>();
  private lidNegativeCache = new Map<string, number>();
  private pendingLidResolves = new Map<string, Promise<string | null>>();
  private sendQueue: Promise<any> = Promise.resolve();
  private lastSentAt = 0;

  private readonly log;

  constructor(public readonly schoolId: number) {
    this.log = logger.child({ module: 'whatsapp', schoolId });
  }

  private withTenant<T>(fn: () => Promise<T>): Promise<T> {
    return runWithTenant({ schoolId: this.schoolId }, fn);
  }

  async connect(): Promise<void> {
    try {
      this.status = 'connecting';
      this.emitStatus();

      const baileys = await import('baileys');
      const makeWASocket = baileys.default;
      const { DisconnectReason, fetchLatestBaileysVersion, makeCacheableSignalKeyStore } = baileys;

      const { state, saveCreds } = await usePrismaAuthState(this.schoolId);
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
          this.log.warn({ statusCode, errorMsg }, 'whatsapp connection closed');

          const shouldReconnect = this.shouldReconnectFor(statusCode, DisconnectReason);

          if (statusCode === DisconnectReason.loggedOut) {
            this.log.info('whatsapp logged out, clearing session');
            await this.withTenant(() => prisma.whatsappSession.deleteMany({}));
            this.status = 'disconnected';
            this.emitStatus();
          } else if (!shouldReconnect) {
            this.status = 'disconnected';
            this.emitStatus();
            this.emitError(`החיבור נסגר על ידי וואטסאפ (קוד ${statusCode}). לחץ "נתק וחבר מחדש" כדי להתחבר שוב.`);
            this.log.warn({ statusCode }, 'disconnect reason not auto-reconnectable');
          } else if (Date.now() < this.cooldownUntil) {
            const waitMs = this.cooldownUntil - Date.now();
            this.status = 'disconnected';
            this.emitStatus();
            this.emitError(`החיבור בקירור עקב ריבוי ניתוקים. נסה שוב בעוד כ-${Math.ceil(waitMs / 60000)} דקות.`);
            this.log.warn({ waitMs }, 'reconnect suppressed: in cooldown window');
          } else if (this.hitReconnectWindowLimit()) {
            this.cooldownUntil = Date.now() + RECONNECT_COOLDOWN_MS;
            this.recentReconnects = [];
            this.status = 'disconnected';
            this.emitStatus();
            this.emitError(`זוהו ניתוקים חוזרים — החיבור בקירור לשעה כדי למנוע חסימת חשבון.`);
            this.log.error({ cooldownUntil: this.cooldownUntil }, 'entering reconnect cooldown');
          } else if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            this.recentReconnects.push(Date.now());
            const delay = this.computeBackoffMs(this.reconnectAttempts);
            this.log.info({ attempt: this.reconnectAttempts, delayMs: delay }, 'whatsapp reconnecting');
            this.status = 'connecting';
            this.emitStatus();
            setTimeout(() => this.connect(), delay);
          } else {
            this.status = 'disconnected';
            this.emitStatus();
            this.emitError(`החיבור נכשל לאחר ${this.maxReconnectAttempts} ניסיונות (שגיאה: ${errorMsg}). נסה "נתק וחבר מחדש".`);
            this.log.error('whatsapp max reconnect attempts reached');
          }
        }

        if (connection === 'open') {
          this.status = 'connected';
          this.currentQR = null;
          this.reconnectAttempts = 0;
          this.emitStatus();
          this.log.info('whatsapp connected successfully');
          this.prefetchLidMappings().catch((err) =>
            this.log.error({ err }, 'error prefetching LID mappings'),
          );
        }
      });

      this.socket.ev.on('creds.update', saveCreds);

      this.socket.ev.on('chats.phoneNumberShare', (data: { lid: string; jid: string }) => {
        const lidId = data.lid.split('@')[0];
        const phone = data.jid.split('@')[0].split(':')[0];
        this.lidToPhone.set(lidId, phone);
        this.phoneToLid.set(phone, lidId);
        this.log.debug({ lidId, phone }, 'phoneNumberShare mapping');
      });

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

          let phone = jidToPhone(rawJid);
          const isLid = rawJid.endsWith('@lid');

          if (isLid) {
            const cached = this.lidToPhone.get(phone);
            if (cached) {
              phone = cached;
            } else {
              this.log.debug({ rawJid }, 'LID not cached, attempting resolve');
              const resolved = await this.resolveLidToPhone(rawJid);
              if (resolved) {
                phone = resolved;
              } else {
                this.log.warn({ rawJid }, 'could not resolve LID to phone, skipping');
                continue;
              }
            }
          }

          this.log.debug({ rawJid, phone, text }, 'incoming message');

          if (!text || !phone) continue;

          this.lastReceived = { phone, text, timestamp: new Date().toISOString() };

          // All downstream DB work runs in this school's tenant context.
          await this.withTenant(async () => {
            await logMessage('IN', phone, text);
            try {
              await handleIncomingMessage(this.schoolId, phone, text, rawJid);
            } catch (error) {
              this.log.error({ err: error, phone }, 'error handling message');
            }
          });
        }
      });
    } catch (error) {
      this.log.error({ err: error }, 'whatsapp connection error');
      this.status = 'disconnected';
      this.emitStatus();
      this.emitError(error instanceof Error ? error.message : 'שגיאה בחיבור לוואטסאפ');
    }
  }

  private shouldReconnectFor(statusCode: number | undefined, DisconnectReason: any): boolean {
    if (!statusCode) return true;
    const reconnectable = new Set<number>(
      [
        DisconnectReason.connectionClosed,
        DisconnectReason.connectionLost,
        DisconnectReason.timedOut,
        DisconnectReason.restartRequired,
      ].filter((v) => typeof v === 'number'),
    );
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

  private async prefetchLidMappings(): Promise<void> {
    const { students, teachers } = await this.withTenant(async () => {
      const students = await prisma.student.findMany({
        select: { parent1Phone: true, parent2Phone: true },
      });
      const teachers = await prisma.teacher.findMany({ select: { phone: true } });
      return { students, teachers };
    });

    const phones = new Set<string>();
    for (const s of students) {
      if (s.parent1Phone) phones.add(s.parent1Phone);
      if (s.parent2Phone) phones.add(s.parent2Phone);
    }
    for (const t of teachers) {
      if (t.phone) phones.add(t.phone);
    }

    if (phones.size === 0 || !this.socket) return;

    const phoneArray = [...phones];
    this.log.debug({ count: phoneArray.length, chunk: PREFETCH_CHUNK }, 'prefetching LID mappings');
    let mapped = 0;
    for (let i = 0; i < phoneArray.length; i += PREFETCH_CHUNK) {
      if (!this.socket || this.status !== 'connected') return;
      const chunk = phoneArray.slice(i, i + PREFETCH_CHUNK);
      try {
        const results = await this.socket.onWhatsApp(...chunk);
        if (results) {
          for (const r of results) {
            if (r.lid) {
              const lidId = typeof r.lid === 'string' ? r.lid.split('@')[0] : String(r.lid);
              const rPhone = r.jid.split('@')[0].split(':')[0];
              this.lidToPhone.set(lidId, rPhone);
              this.phoneToLid.set(rPhone, lidId);
              mapped++;
            }
          }
        }
      } catch (err) {
        this.log.error({ err, chunkStart: i }, 'prefetchLidMappings chunk error');
      }
      if (i + PREFETCH_CHUNK < phoneArray.length) {
        await new Promise((r) => setTimeout(r, PREFETCH_CHUNK_GAP_MS));
      }
    }
    this.log.info({ mapped }, 'prefetched LID mappings');
  }

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

  private async doResolveLidToPhone(_lidJid: string, lidId: string): Promise<string | null> {
    try {
      const { students, teachers } = await this.withTenant(async () => {
        const students = await prisma.student.findMany({
          select: { parent1Phone: true, parent2Phone: true },
        });
        const teachers = await prisma.teacher.findMany({ select: { phone: true } });
        return { students, teachers };
      });

      const phones = new Set<string>();
      for (const s of students) {
        if (s.parent1Phone) phones.add(s.parent1Phone);
        if (s.parent2Phone) phones.add(s.parent2Phone);
      }
      for (const t of teachers) {
        if (t.phone) phones.add(t.phone);
      }

      if (!this.socket || phones.size === 0) return null;

      const phoneArray = [...phones];
      this.log.debug({ count: phoneArray.length }, 'resolving LID, querying known phones');
      let found: string | null = null;
      for (let i = 0; i < phoneArray.length; i += PREFETCH_CHUNK) {
        if (!this.socket) break;
        const chunk = phoneArray.slice(i, i + PREFETCH_CHUNK);
        try {
          const results = await this.socket.onWhatsApp(...chunk);
          if (results) {
            for (const r of results) {
              if (r.lid) {
                const rLidId = typeof r.lid === 'string' ? r.lid.split('@')[0] : r.lid.toString?.();
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
          this.log.error({ err, chunkStart: i }, 'resolveLidToPhone chunk error');
        }
        if (found) return found;
        if (i + PREFETCH_CHUNK < phoneArray.length) {
          await new Promise((r) => setTimeout(r, PREFETCH_CHUNK_GAP_MS));
        }
      }
    } catch (err) {
      this.log.error({ err }, 'error resolving LID to phone');
    }
    return null;
  }

  resolveJidForSend(phone: string): string {
    const lidId = this.phoneToLid.get(phone);
    if (lidId) {
      return `${lidId}@lid`;
    }
    return `${phone}@s.whatsapp.net`;
  }

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
    this.sendQueue = task.catch(() => undefined);
    this.log.debug({ label }, 'send queued');
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
    buttons: Array<{ buttonId: string; buttonText: { displayText: string } }>,
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
    this.connect().catch((err) => this.log.error({ err }, 'whatsapp restart connect error'));
  }

  async logout(): Promise<void> {
    if (this.socket) {
      try {
        await this.socket.logout();
      } catch {
        // socket may already be closed
      }
      this.socket.end(undefined);
      this.socket = null;
    }
    await this.withTenant(() => prisma.whatsappSession.deleteMany({}));
    this.log.info('whatsapp session cleared from DB');
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
    emitToSchool(this.schoolId, 'whatsapp:status', { status: this.status });
  }

  private emitQR(): void {
    if (this.currentQR) {
      emitToSchool(this.schoolId, 'whatsapp:qr', { qr: this.currentQR });
    }
  }

  private emitError(message: string): void {
    emitToSchool(this.schoolId, 'whatsapp:error', { error: message });
  }
}
