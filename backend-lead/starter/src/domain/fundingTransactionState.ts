import { AppError } from '../lib/errors';

// Pending -> Completed | Failed | Flagged. Terminal states have no way out.
// Flagged = PSP reported success but the facts did not match (e.g. amount);
// nothing is credited and a human resolves it.
export type FundingTransactionStatus = 'Pending' | 'Completed' | 'Failed' | 'Flagged';

const TRANSITIONS: Record<FundingTransactionStatus, ReadonlySet<FundingTransactionStatus>> = {
  Pending: new Set<FundingTransactionStatus>(['Completed', 'Failed', 'Flagged']),
  Completed: new Set(),
  Failed: new Set(),
  Flagged: new Set(),
};

export function canTransition(from: FundingTransactionStatus, to: FundingTransactionStatus): boolean {
  return TRANSITIONS[from].has(to);
}

export function isTerminal(status: FundingTransactionStatus): boolean {
  return TRANSITIONS[status].size === 0;
}

export class InvalidTransitionError extends AppError {
  constructor(from: FundingTransactionStatus, to: FundingTransactionStatus) {
    super(409, 'invalid_transition', `cannot move funding transaction from ${from} to ${to}`, { from, to });
  }
}

export function assertTransition(from: FundingTransactionStatus, to: FundingTransactionStatus): void {
  if (!canTransition(from, to)) {
    throw new InvalidTransitionError(from, to);
  }
}
