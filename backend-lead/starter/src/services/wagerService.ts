import { sequelize } from '../db/sequelize';
import { Wallet, WalletTx } from '../db/models';
import { dec } from '../lib/money';
import { applyBalanceChange, lockWallet } from './ledgerService';

export interface PlaceWagerInput {
  walletId: string;
  amount: string;
}

export async function placeWager(input: PlaceWagerInput): Promise<{ wallet: Wallet; entry: WalletTx }> {
  const amount = dec(input.amount);
  return sequelize.transaction(async (t) => {
    const wallet = await lockWallet(input.walletId, t);
    return applyBalanceChange(
      wallet,
      { kind: 'wager', delta: amount.negated(), turnoverAccrued: amount },
      t,
    );
  });
}
