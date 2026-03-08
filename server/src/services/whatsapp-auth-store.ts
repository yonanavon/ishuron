import { prisma } from '../lib/prisma';
import {
  AuthenticationState,
  SignalDataTypeMap,
  initAuthCreds,
  proto,
  BufferJSON,
} from 'baileys';

/**
 * Prisma-based auth state for Baileys.
 * Stores authentication credentials and signal keys in PostgreSQL.
 */
export async function usePrismaAuthState(): Promise<{
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
}> {
  const writeData = async (key: string, data: any) => {
    const serialized = JSON.parse(JSON.stringify(data, BufferJSON.replacer));
    await prisma.whatsappSession.upsert({
      where: { key },
      update: { value: serialized },
      create: { key, value: serialized },
    });
  };

  const readData = async (key: string): Promise<any | null> => {
    const row = await prisma.whatsappSession.findUnique({ where: { key } });
    if (!row) return null;
    return JSON.parse(JSON.stringify(row.value), BufferJSON.reviver);
  };

  const removeData = async (key: string) => {
    await prisma.whatsappSession.deleteMany({ where: { key } });
  };

  // Load or create creds
  let creds = await readData('creds');
  if (!creds) {
    creds = initAuthCreds();
    await writeData('creds', creds);
  }

  const state: AuthenticationState = {
    creds,
    keys: {
      get: async <T extends keyof SignalDataTypeMap>(
        type: T,
        ids: string[]
      ): Promise<{ [id: string]: SignalDataTypeMap[T] }> => {
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
