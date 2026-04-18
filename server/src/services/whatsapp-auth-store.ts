import { prisma, runWithTenant } from '../lib/prisma';

/**
 * Prisma-based auth state for Baileys, scoped to a single school.
 * Each school has its own independent set of WhatsApp session keys.
 */
export async function usePrismaAuthState(schoolId: number): Promise<{
  state: any;
  saveCreds: () => Promise<void>;
}> {
  const baileys = await import('baileys');
  const { initAuthCreds, proto, BufferJSON } = baileys;

  // Every DB call must run inside this school's tenant context so the
  // Prisma extension scopes reads/writes to this school's rows only.
  const run = <T>(fn: () => Promise<T>): Promise<T> =>
    runWithTenant({ schoolId }, fn);

  const writeData = async (key: string, data: any) => {
    const serialized = JSON.parse(JSON.stringify(data, BufferJSON.replacer));
    await run(() =>
      prisma.whatsappSession.upsert({
        where: { schoolId_key: { schoolId, key } },
        update: { value: serialized },
        create: { schoolId, key, value: serialized },
      }),
    );
  };

  const readData = async (key: string): Promise<any | null> => {
    const row = await run(() =>
      prisma.whatsappSession.findUnique({ where: { schoolId_key: { schoolId, key } } }),
    );
    if (!row) return null;
    return JSON.parse(JSON.stringify(row.value), BufferJSON.reviver);
  };

  const removeData = async (key: string) => {
    await run(() => prisma.whatsappSession.deleteMany({ where: { key } }));
  };

  let creds = await readData('creds');
  if (!creds) {
    creds = initAuthCreds();
    await writeData('creds', creds);
  }

  const state = {
    creds,
    keys: {
      get: async (type: string, ids: string[]): Promise<Record<string, any>> => {
        const result: Record<string, any> = {};
        for (const id of ids) {
          const data = await readData(`${type}-${id}`);
          if (data) {
            if (type === 'app-state-sync-key') {
              result[id] = proto.Message.AppStateSyncKeyData.fromObject(data);
            } else {
              result[id] = data;
            }
          }
        }
        return result;
      },
      set: async (data: Record<string, Record<string, any | null>>) => {
        for (const [type, entries] of Object.entries(data)) {
          for (const [id, value] of Object.entries(entries)) {
            if (value) {
              await writeData(`${type}-${id}`, value);
            } else {
              await removeData(`${type}-${id}`);
            }
          }
        }
      },
    },
  };

  return {
    state,
    saveCreds: async () => {
      await writeData('creds', state.creds);
    },
  };
}
