/**
 * Normalize Israeli phone numbers to 972XXXXXXXXX format
 */
export function normalizePhone(phone: string): string {
  // Remove all non-digit characters
  let digits = phone.replace(/\D/g, '');

  // Handle different formats
  if (digits.startsWith('972')) {
    // Already in international format
  } else if (digits.startsWith('0')) {
    digits = '972' + digits.slice(1);
  } else if (digits.length === 9) {
    // Missing leading zero
    digits = '972' + digits;
  }

  return digits;
}

/**
 * Format phone for display (0XX-XXX-XXXX)
 */
export function formatPhoneDisplay(phone: string): string {
  const normalized = normalizePhone(phone);
  const local = '0' + normalized.slice(3);
  return local.replace(/(\d{3})(\d{3})(\d{4})/, '$1-$2-$3');
}

/**
 * Convert WhatsApp JID to phone number
 */
export function jidToPhone(jid: string): string {
  return jid.split('@')[0].split(':')[0];
}

/**
 * Convert phone number to WhatsApp JID
 */
export function phoneToJid(phone: string): string {
  const normalized = normalizePhone(phone);
  return `${normalized}@s.whatsapp.net`;
}
