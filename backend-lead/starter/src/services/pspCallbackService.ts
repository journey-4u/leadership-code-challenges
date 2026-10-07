import { sequelize } from '../db/sequelize';
import { FundingTransaction } from '../db/models';
import {
  assertTransition,
  FundingTransactionStatus,
  InvalidTransitionError,
  isTerminal,
} from '../domain/fundingTransactionState';
import { NotFoundError } from '../lib/errors';
import { dec, toMoneyString } from '../lib/money';
import { applyBalanceChange, lockWallet } from './ledgerService';

export type PspCallbackStatus = 'completed' | 'failed';

export interface PspCallbackInput {
  pspRef: string;
  status: PspCallbackStatus;
  amount: string;
}

export interface PspCallbackResult {
  transactionId: string;
  status: FundingTransactionStatus;
  /** true when this delivery changed state; false for an idempotent replay. */
  applied: boolean;
}

// Concurrent deliveries serialize on the FOR UPDATE lock of the deposit row.
// The second one re-reads the committed status and becomes a replay.
export async function handlePspCallback(input: PspCallbackInput): Promise<PspCallbackResult> {
  return sequelize.transaction(async (t) => {
    const txn = await FundingTransaction.findOne({
      where: { pspRef: input.pspRef, type: 'deposit' },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    if (!txn) throw new NotFoundError('deposit with pspRef', input.pspRef);

    const target = decideOutcome(txn, input);

    if (isTerminal(txn.status)) {
      if (isReplay(txn, target, input)) {
        return { transactionId: txn.id, status: txn.status, applied: false };
      }
      throw new InvalidTransitionError(txn.status, target.status);
    }

    assertTransition(txn.status, target.status);

    if (target.status === 'Completed') {
      const wallet = await lockWallet(txn.walletId, t);
      const amount = dec(txn.amount);
      await applyBalanceChange(
        wallet,
        {
          kind: 'deposit',
          delta: amount,
          reference: { type: 'funding_transaction', id: txn.id },
          turnoverRequired: amount.multipliedBy(txn.turnoverMultiplier),
        },
        t,
      );
    }

    txn.status = target.status;
    txn.statusReason = target.reason;
    txn.pspAmount = toMoneyString(dec(input.amount));
    txn.finalizedAt = new Date();
    await txn.save({ transaction: t });

    return { transactionId: txn.id, status: txn.status, applied: true };
  });
}

interface Outcome {
  status: FundingTransactionStatus;
  reason: string | null;
}

// Amount mismatch: credit neither amount, flag for manual reconciliation.
function decideOutcome(txn: FundingTransaction, input: PspCallbackInput): Outcome {
  if (input.status === 'failed') {
    return { status: 'Failed', reason: 'psp_reported_failure' };
  }
  if (!dec(input.amount).isEqualTo(dec(txn.amount))) {
    return { status: 'Flagged', reason: 'amount_mismatch' };
  }
  return { status: 'Completed', reason: null };
}

// Same terminal outcome again = replay. Anything else is a contradiction.
function isReplay(txn: FundingTransaction, target: Outcome, input: PspCallbackInput): boolean {
  if (txn.status !== target.status) return false;
  if (target.status === 'Failed') return true;
  if (txn.pspAmount === null) return false;
  return dec(txn.pspAmount).isEqualTo(dec(input.amount));
}
