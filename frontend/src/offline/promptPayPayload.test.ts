import { describe, expect, it } from 'vitest';

import { formatPromptPayAmount, generatePromptPayPayload, generateStaticPromptPayPayload, promptPayAccountSuffix } from './promptPayPayload';

const mobileMerchant = '0016A00000067701011101130066801234567';
const nationalIdMerchant = '0016A00000067701011102131111111111111';

describe('PromptPay payload Python parity', () => {
  it.each([
    [mobileMerchant, '0.01', '00020101021229370016A000000677010111011300668012345675802TH530376454040.0163042E01'],
    [mobileMerchant, '69.00', '00020101021229370016A000000677010111011300668012345675802TH5303764540569.006304D91D'],
    [mobileMerchant, '200.00', '00020101021229370016A000000677010111011300668012345675802TH53037645406200.0063046492'],
    [mobileMerchant, '207.00', '00020101021229370016A000000677010111011300668012345675802TH53037645406207.006304A38A'],
    [mobileMerchant, '69.995', '00020101021229370016A000000677010111011300668012345675802TH5303764540570.0063046B37'],
    [mobileMerchant, '999999.99', '00020101021229370016A000000677010111011300668012345675802TH53037645409999999.9963049F64'],
    [nationalIdMerchant, '4.22', '00020101021229370016A000000677010111021311111111111115802TH530376454044.2263047429'],
    [nationalIdMerchant, '207.00', '00020101021229370016A000000677010111021311111111111115802TH53037645406207.0063041D85'],
  ])('matches Python for merchant %s and amount %s', (merchant, amount, expected) => {
    expect(generatePromptPayPayload(merchant, amount)).toBe(expected);
  });

  it('uses Decimal ROUND_HALF_UP-compatible deterministic formatting', () => {
    expect(formatPromptPayAmount('69.994')).toBe('69.99');
    expect(formatPromptPayAmount('69.995')).toBe('70.00');
    expect(formatPromptPayAmount(0.01)).toBe('0.01');
  });

  it.each(['0', '-1', '1000000', 'not-a-number', 'NaN', 'Infinity'])('rejects invalid amount %s', (amount) => {
    expect(() => generatePromptPayPayload(mobileMerchant, amount)).toThrow();
  });
});

describe('static PromptPay payload for checking the account', () => {
  it('matches the Python encoder with no amount and the static marker', () => {
    // Same fields as a sale's QR, but 01=11 (static) and no tag 54.
    expect(generateStaticPromptPayPayload(mobileMerchant)).toBe('00020101021129370016A000000677010111011300668012345675802TH530376463046197');
  });

  it('refuses a config that is not PromptPay', () => {
    expect(() => generateStaticPromptPayPayload('0016XXXX')).toThrow();
  });

  it('shows only the last four digits of the receiving number', () => {
    expect(promptPayAccountSuffix(mobileMerchant)).toBe('4567');
    expect(promptPayAccountSuffix(nationalIdMerchant)).toBe('1111');
    expect(promptPayAccountSuffix('garbage')).toBeNull();
    expect(promptPayAccountSuffix('0016A000000677010111')).toBeNull();
  });
});
