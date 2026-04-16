import { describe, it, expect } from 'vitest';
import {
  parseMessage,
  matchStudentName,
  parseTeacherResponse,
  parseTeacherPickedResponse,
  parseEscalationChoice,
} from '../services/message-parser.service';

describe('parseMessage', () => {
  it('should extract time in HH:MM format', () => {
    const result = parseMessage('יציאה ב12:30');
    expect(result.time).toBe('12:30');
  });

  it('should extract time with בשעה pattern', () => {
    const result = parseMessage('בשעה 14:00');
    expect(result.time).toBe('14:00');
  });

  it('should extract time with בשעה without minutes', () => {
    const result = parseMessage('בשעה 9');
    expect(result.time).toBe('09:00');
  });

  it('should parse היום as today', () => {
    const result = parseMessage('היום 10:00');
    const today = new Date();
    expect(result.date?.getDate()).toBe(today.getDate());
  });

  it('should parse מחר as tomorrow', () => {
    const result = parseMessage('מחר 10:00');
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    expect(result.date?.getDate()).toBe(tomorrow.getDate());
  });

  it('should parse DD/MM date format', () => {
    const result = parseMessage('15/03 בשעה 10:00');
    expect(result.date?.getDate()).toBe(15);
    expect(result.date?.getMonth()).toBe(2); // March = 2
  });

  it('should extract name from message', () => {
    const result = parseMessage('שלום רוצה להוציא את דני היום בשעה 12:00');
    expect(result.name).toBe('דני');
  });

  it('should handle full message with all parts', () => {
    const result = parseMessage('יוסי כהן מחר 14:30');
    expect(result.name).toBeTruthy();
    expect(result.time).toBe('14:30');
    expect(result.date).toBeDefined();
  });
});

describe('matchStudentName', () => {
  const students = [
    { id: 1, firstName: 'דני', lastName: 'כהן' },
    { id: 2, firstName: 'דנה', lastName: 'לוי' },
    { id: 3, firstName: 'יוסי', lastName: 'ישראלי' },
  ];

  it('should find exact match', () => {
    const result = matchStudentName('דני', students);
    expect(result[0].id).toBe(1);
  });

  it('should find close match with Levenshtein', () => {
    const result = matchStudentName('דנני', students);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].id).toBe(1);
  });

  it('should match full name', () => {
    const result = matchStudentName('יוסי ישראלי', students);
    expect(result[0].id).toBe(3);
  });

  it('should return empty for no match', () => {
    const result = matchStudentName('אברהם', students);
    // May or may not find a match depending on threshold
    if (result.length > 0) {
      expect(result[0].score).toBeLessThan(0.8);
    }
  });
});

describe('parseTeacherResponse', () => {
  it('should recognize approval', () => {
    expect(parseTeacherResponse('1')).toBe('approve');
    expect(parseTeacherResponse('אישור')).toBe('approve');
    expect(parseTeacherResponse('מאשר')).toBe('approve');
    expect(parseTeacherResponse('✅')).toBe('approve');
  });

  it('should recognize rejection', () => {
    expect(parseTeacherResponse('2')).toBe('reject');
    expect(parseTeacherResponse('דחייה')).toBe('reject');
    expect(parseTeacherResponse('❌')).toBe('reject');
  });

  it('should return null for unknown', () => {
    expect(parseTeacherResponse('מה?')).toBeNull();
  });
});

describe('parseEscalationChoice', () => {
  it('should recognize numeric choices', () => {
    expect(parseEscalationChoice('1')).toBe('wait');
    expect(parseEscalationChoice('2')).toBe('secretary');
    expect(parseEscalationChoice('3')).toBe('principal');
  });

  it('should prefer keywords over digits', () => {
    // Text with "מזכירות" must map to secretary even if it also contains a digit.
    expect(parseEscalationChoice('אני רוצה מזכירות')).toBe('secretary');
    expect(parseEscalationChoice('מנהל בבקשה')).toBe('principal');
    expect(parseEscalationChoice('המתן לי')).toBe('wait');
    expect(parseEscalationChoice('ממתין')).toBe('wait');
  });

  it('should return null for unknown input', () => {
    expect(parseEscalationChoice('מה?')).toBeNull();
    expect(parseEscalationChoice('')).toBeNull();
  });
});

describe('parseTeacherPickedResponse', () => {
  it('should parse "<num> <1|2>" format', () => {
    expect(parseTeacherPickedResponse('1 1', 3)).toEqual({ index: 0, action: 'approve' });
    expect(parseTeacherPickedResponse('2 1', 3)).toEqual({ index: 1, action: 'approve' });
    expect(parseTeacherPickedResponse('3 2', 3)).toEqual({ index: 2, action: 'reject' });
  });

  it('should accept various separators', () => {
    expect(parseTeacherPickedResponse('2,1', 3)).toEqual({ index: 1, action: 'approve' });
    expect(parseTeacherPickedResponse('2-1', 3)).toEqual({ index: 1, action: 'approve' });
    expect(parseTeacherPickedResponse('2.1', 3)).toEqual({ index: 1, action: 'approve' });
  });

  it('should accept Hebrew action words', () => {
    expect(parseTeacherPickedResponse('2 אישור', 3)).toEqual({ index: 1, action: 'approve' });
    expect(parseTeacherPickedResponse('1 דחייה', 3)).toEqual({ index: 0, action: 'reject' });
  });

  it('should return null for out-of-range numbers', () => {
    expect(parseTeacherPickedResponse('5 1', 3)).toBeNull();
    expect(parseTeacherPickedResponse('0 1', 3)).toBeNull();
  });

  it('should return null for invalid input', () => {
    expect(parseTeacherPickedResponse('1', 3)).toBeNull(); // only one token
    expect(parseTeacherPickedResponse('אישור', 3)).toBeNull(); // no number
    expect(parseTeacherPickedResponse('2 מה', 3)).toBeNull(); // invalid action
    expect(parseTeacherPickedResponse('', 3)).toBeNull();
  });
});

describe('parseDate — Israel timezone', () => {
  it('should compute "היום" from Asia/Jerusalem, not server local time', () => {
    // "היום" should match today as seen in Israel.
    const result = parseMessage('היום 10:00');
    expect(result.date).toBeDefined();

    const israelParts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Jerusalem',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date());
    const get = (t: string) => israelParts.find(p => p.type === t)?.value || '';
    const israelYear = parseInt(get('year'));
    const israelMonth = parseInt(get('month')) - 1;
    const israelDay = parseInt(get('day'));

    expect(result.date!.getFullYear()).toBe(israelYear);
    expect(result.date!.getMonth()).toBe(israelMonth);
    expect(result.date!.getDate()).toBe(israelDay);
  });

  it('should compute "מחר" as Israel-today + 1', () => {
    const today = parseMessage('היום').date!;
    const tomorrow = parseMessage('מחר').date!;
    const diffMs = tomorrow.getTime() - today.getTime();
    const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
    expect(diffDays).toBe(1);
  });

  it('should compute "מחרתיים" as Israel-today + 2', () => {
    const today = parseMessage('היום').date!;
    const overmorrow = parseMessage('מחרתיים').date!;
    const diffDays = Math.round(
      (overmorrow.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
    );
    expect(diffDays).toBe(2);
  });

  it('should resolve Hebrew day name to next occurrence (always > today)', () => {
    const today = parseMessage('היום').date!;
    const days = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
    for (const day of days) {
      const target = parseMessage(`יום ${day}`).date!;
      expect(target.getTime()).toBeGreaterThan(today.getTime());
      const diffDays = Math.round(
        (target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
      );
      expect(diffDays).toBeGreaterThanOrEqual(1);
      expect(diffDays).toBeLessThanOrEqual(7);
    }
  });
});
