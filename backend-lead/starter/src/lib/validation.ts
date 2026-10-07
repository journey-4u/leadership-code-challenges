import BigNumber from 'bignumber.js';
import { z } from 'zod';

// Max 18 fractional digits, matching DECIMAL(36,18), so nothing is rounded on input.
const MONEY_PATTERN = /^\d{1,18}(\.\d{1,18})?$/;

export const positiveMoney = z
  .string()
  .regex(MONEY_PATTERN, 'amount must be a decimal string like "100.50"')
  .refine((s) => {
    const bn = new BigNumber(s);
    return bn.isFinite() && bn.isGreaterThan(0);
  }, 'amount must be positive');

export const uuid = z.string().uuid();
