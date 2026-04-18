import * as XLSX from 'xlsx';
import { prisma } from '../lib/prisma';
import { normalizePhone } from '../utils/phone';

interface ImportResult {
  imported: number;
  skipped: number;
  errors: string[];
}

const COLUMN_MAP: Record<string, string> = {
  'שם פרטי': 'firstName',
  'שם משפחה': 'lastName',
  'ת.ז': 'idNumber',
  'תעודת זהות': 'idNumber',
  'שם הורה 1': 'parent1Name',
  'טלפון הורה 1': 'parent1Phone',
  'שם הורה 2': 'parent2Name',
  'טלפון הורה 2': 'parent2Phone',
  'כיתה': 'className',
  // English fallbacks
  'firstName': 'firstName',
  'lastName': 'lastName',
  'idNumber': 'idNumber',
  'parent1Name': 'parent1Name',
  'parent1Phone': 'parent1Phone',
  'parent2Name': 'parent2Name',
  'parent2Phone': 'parent2Phone',
  'className': 'className',
};

export async function importStudents(schoolId: number, buffer: Buffer, _filename: string): Promise<ImportResult> {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet);

  const result: ImportResult = { imported: 0, skipped: 0, errors: [] };

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const mapped: Record<string, string> = {};

    // Map columns
    for (const [key, value] of Object.entries(row)) {
      const mappedKey = COLUMN_MAP[key.trim()];
      if (mappedKey) {
        mapped[mappedKey] = String(value).trim();
      }
    }

    // Validate required fields
    if (!mapped.firstName || !mapped.lastName || !mapped.idNumber || !mapped.parent1Name || !mapped.parent1Phone || !mapped.className) {
      result.errors.push(`שורה ${i + 2}: שדות חובה חסרים`);
      result.skipped++;
      continue;
    }

    try {
      await prisma.student.upsert({
        where: { schoolId_idNumber: { schoolId, idNumber: mapped.idNumber } },
        update: {
          firstName: mapped.firstName,
          lastName: mapped.lastName,
          parent1Name: mapped.parent1Name,
          parent1Phone: normalizePhone(mapped.parent1Phone),
          parent2Name: mapped.parent2Name || null,
          parent2Phone: mapped.parent2Phone ? normalizePhone(mapped.parent2Phone) : null,
          className: mapped.className,
        },
        create: {
          schoolId,
          firstName: mapped.firstName,
          lastName: mapped.lastName,
          idNumber: mapped.idNumber,
          parent1Name: mapped.parent1Name,
          parent1Phone: normalizePhone(mapped.parent1Phone),
          parent2Name: mapped.parent2Name || null,
          parent2Phone: mapped.parent2Phone ? normalizePhone(mapped.parent2Phone) : null,
          className: mapped.className,
        },
      });
      result.imported++;
    } catch (error: any) {
      result.errors.push(`שורה ${i + 2}: ${error.message}`);
      result.skipped++;
    }
  }

  return result;
}
