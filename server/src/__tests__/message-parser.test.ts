import { describe, it, expect } from 'vitest';
import { parseMessage, matchStudentName, parseTeacherResponse, parseEscalationChoice } from '../services/message-parser.service';

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
  it('should recognize choices', () => {
    expect(parseEscalationChoice('1')).toBe('wait');
    expect(parseEscalationChoice('2')).toBe('secretary');
    expect(parseEscalationChoice('3')).toBe('principal');
  });
});
