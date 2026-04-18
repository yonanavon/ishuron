import { WhatsAppService } from './whatsapp.service';
import { prisma, runWithTenant } from '../lib/prisma';
import { logger } from '../lib/logger';

const log = logger.child({ module: 'wa-registry' });

class WhatsAppRegistry {
  private instances = new Map<number, WhatsAppService>();

  get(schoolId: number): WhatsAppService {
    let inst = this.instances.get(schoolId);
    if (!inst) {
      inst = new WhatsAppService(schoolId);
      this.instances.set(schoolId, inst);
    }
    return inst;
  }

  has(schoolId: number): boolean {
    return this.instances.has(schoolId);
  }

  getStatusIfExists(schoolId: number): string | null {
    const inst = this.instances.get(schoolId);
    return inst ? inst.getStatus() : null;
  }

  getAll(): Map<number, WhatsAppService> {
    return this.instances;
  }

  /**
   * Connect WhatsApp for every active school. Called once at server start.
   * Each connect runs independently; a failure in one school does not block others.
   */
  async connectAll(): Promise<void> {
    const schools = await runWithTenant({ schoolId: null, bypass: true }, () =>
      prisma.school.findMany({ where: { isActive: true }, select: { id: true, slug: true } }),
    );
    log.info({ count: schools.length }, 'connecting WhatsApp instances');
    for (const school of schools) {
      const inst = this.get(school.id);
      inst.connect().catch((err) =>
        log.error({ err, schoolId: school.id, slug: school.slug }, 'initial connect failed'),
      );
    }
  }

  async disconnect(schoolId: number): Promise<void> {
    const inst = this.instances.get(schoolId);
    if (!inst) return;
    await inst.logout();
    this.instances.delete(schoolId);
  }
}

let registry: WhatsAppRegistry | null = null;

export function getWhatsAppRegistry(): WhatsAppRegistry {
  if (!registry) registry = new WhatsAppRegistry();
  return registry;
}
