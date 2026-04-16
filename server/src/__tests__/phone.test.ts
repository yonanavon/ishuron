import { describe, it, expect } from 'vitest';
import { normalizePhone, formatPhoneDisplay, jidToPhone, phoneToJid } from '../utils/phone';

describe('normalizePhone', () => {
  it('should keep already-international format', () => {
    expect(normalizePhone('972501234567')).toBe('972501234567');
  });

  it('should convert 0-prefix local format', () => {
    expect(normalizePhone('0501234567')).toBe('972501234567');
  });

  it('should add country code for 9-digit numbers', () => {
    expect(normalizePhone('501234567')).toBe('972501234567');
  });

  it('should strip non-digit characters', () => {
    expect(normalizePhone('050-123-4567')).toBe('972501234567');
    expect(normalizePhone('+972 50 123 4567')).toBe('972501234567');
    expect(normalizePhone('(050) 1234567')).toBe('972501234567');
  });
});

describe('formatPhoneDisplay', () => {
  it('should format as 0XX-XXX-XXXX', () => {
    expect(formatPhoneDisplay('972501234567')).toBe('050-123-4567');
    expect(formatPhoneDisplay('0501234567')).toBe('050-123-4567');
  });
});

describe('jidToPhone', () => {
  it('should extract phone from standard JID', () => {
    expect(jidToPhone('972501234567@s.whatsapp.net')).toBe('972501234567');
  });

  it('should strip device suffix', () => {
    expect(jidToPhone('972501234567:12@s.whatsapp.net')).toBe('972501234567');
  });

  it('should extract ID from LID', () => {
    expect(jidToPhone('123456789@lid')).toBe('123456789');
  });
});

describe('phoneToJid', () => {
  it('should build standard WhatsApp JID', () => {
    expect(phoneToJid('0501234567')).toBe('972501234567@s.whatsapp.net');
    expect(phoneToJid('972501234567')).toBe('972501234567@s.whatsapp.net');
  });
});
