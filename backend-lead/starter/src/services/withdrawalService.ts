import BigNumber from 'bignumber.js';
import { sequelize } from '../db/sequelize';
import { FundingTransaction, Wallet } from '../db/models';
import { AppError } from '../lib/errors';
import { dec, toMoneyString } from '../lib/money';
import { applyBalanceChange, lockWalletByMemberId } from './ledgerService';

export interface CreateWithdrawalInput {
  memberId: string;
  amount: string;
}

export class TurnoverLockedError extends AppError {
  constructor(required: BigNumber, accrued: BigNumber) {
    super(422, 'turnover_locked', 'turnover requirement not yet met', {
      turnoverRequired: required.toFixed(),
      turnoverAccrued: accrued.toFixed(),
      outstandingTurnover: required.minus(accrued).toFixed(),
    });
  }
}

export async function createWithdrawal(
  input: CreateWithdrawalInput,
): Promise<{ transaction: FundingTransaction; wallet: Wallet }> {
  const amount = dec(input.amount);
  return sequelize.transaction(async (t) => {
    const wallet = await lockWalletByMemberId(input.memberId, t);

    const required = dec(wallet.turnoverRequired);
    const accrued = dec(wallet.turnoverAccrued);
    if (accrued.isLessThan(required)) {
      throw new TurnoverLockedError(required, accrued);
    }

    const transaction = await FundingTransaction.create(
      {
        memberId: input.memberId,
        walletId: wallet.id,
        type: 'withdrawal',
        status: 'Pending',
        amount: toMoneyString(amount),
        turnoverMultiplier: 0,
        pspRef: null,
      },
      { transaction: t },
    );

    // Debit now so the member cannot wager money earmarked for payout.
    await applyBalanceChange(
      wallet,
      {
        kind: 'withdrawal',
        delta: amount.negated(),
        reference: { type: 'funding_transaction', id: transaction.id },
      },
      t,
    );

    return { transaction, wallet };
  });
}
