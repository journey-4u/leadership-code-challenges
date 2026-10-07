import { randomUUID } from 'crypto';
import { sequelize } from '../db/sequelize';
import { FundingTransaction, Wallet } from '../db/models';
import { NotFoundError } from '../lib/errors';
import { dec, toMoneyString } from '../lib/money';

export interface CreateDepositInput {
  memberId: string;
  amount: string;
  turnoverMultiplier: number;
}

export async function createDeposit(input: CreateDepositInput): Promise<FundingTransaction> {
  return sequelize.transaction(async (t) => {
    const wallet = await Wallet.findOne({ where: { memberId: input.memberId }, transaction: t });
    if (!wallet) throw new NotFoundError('member', input.memberId);

    return FundingTransaction.create(
      {
        memberId: input.memberId,
        walletId: wallet.id,
        type: 'deposit',
        status: 'Pending',
        amount: toMoneyString(dec(input.amount)),
        turnoverMultiplier: input.turnoverMultiplier,
        pspRef: newPspRef(),
      },
      { transaction: t },
    );
  });
}

function newPspRef(): string {
  return `dep_${randomUUID().replace(/-/g, '')}`;
}
