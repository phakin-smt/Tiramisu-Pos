export const PROMPTPAY_GUID = 'A000000677010111';
const MAX_AMOUNT_SATANG = 99_999_999n;

export class PromptPayPayloadError extends Error {}

function tlv(tag: string, value: string): string {
  if (value.length > 99) throw new PromptPayPayloadError('PromptPay field is too long');
  return `${tag}${String(value.length).padStart(2, '0')}${value}`;
}

function crc16Xmodem(value: string): string {
  let crc = 0xffff;
  for (const character of value) {
    const byte = character.charCodeAt(0);
    if (byte > 0x7f) throw new PromptPayPayloadError('PromptPay payload must be ASCII');
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

export function formatPromptPayAmount(value: number | string): string {
  const raw = String(value).trim();
  const match = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/.exec(raw);
  if (!match) throw new PromptPayPayloadError('Payment amount is invalid');
  const [, sign, integerPart, decimalFraction, fractionOnly, exponentText = '0'] = match;
  const whole = integerPart ?? '0';
  const fraction = decimalFraction ?? fractionOnly ?? '';
  if (sign === '-') throw new PromptPayPayloadError('Payment amount must be between 0.01 and 999999.99');
  const exponent = Number(exponentText);
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 1000) {
    throw new PromptPayPayloadError('Payment amount is invalid');
  }
  const digits = BigInt(`${whole}${fraction}`);
  const centShift = exponent - fraction.length + 2;
  let satang: bigint;
  if (centShift >= 0) {
    satang = digits * (10n ** BigInt(centShift));
  } else {
    const divisor = 10n ** BigInt(-centShift);
    const quotient = digits / divisor;
    const remainder = digits % divisor;
    satang = quotient + (remainder * 2n >= divisor ? 1n : 0n);
  }
  if (satang < 1n || satang > MAX_AMOUNT_SATANG) {
    throw new PromptPayPayloadError('Payment amount must be between 0.01 and 999999.99');
  }
  return `${satang / 100n}.${String(satang % 100n).padStart(2, '0')}`;
}

export function generatePromptPayPayload(
  merchantAccountInfo: string,
  amount: number | string,
): string {
  if (!merchantAccountInfo.startsWith(`0016${PROMPTPAY_GUID}`)) {
    throw new PromptPayPayloadError('PromptPay merchant configuration is invalid');
  }
  const formattedAmount = formatPromptPayAmount(amount);
  const body = [
    tlv('00', '01'),
    tlv('01', '12'),
    tlv('29', merchantAccountInfo),
    tlv('58', 'TH'),
    tlv('53', '764'),
    tlv('54', formattedAmount),
  ].join('');
  const crcInput = `${body}6304`;
  return `${crcInput}${crc16Xmodem(crcInput)}`;
}
