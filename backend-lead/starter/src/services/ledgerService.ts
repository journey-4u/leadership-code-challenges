import BigNumber from 'bignumber.js';
import { Transaction } from 'sequelize';
import { Wallet, WalletTx } from '../db/models';
import { WalletTxKind, WalletTxReferenceType } from '../db/models/walletTx';
import { dec, toMoneyString, ZERO } from '../lib/money';
import { AppError, NotFoundError } from '../lib/errors';

// All balance changes go through applyBalanceChange, with the wallet row
// already locked by the caller.
// Lock order everywhere: funding_transactions row -> wallets row.

export class InsufficientBalanceError extends AppError {
  constructor(balance: BigNumber, requested: BigNumber) {
    super(422, 'insufficient_balance', 'wallet balance is too low for this debit', {
      balance: balance.toFixed(),
      requested: requested.toFixed(),
      shortfall: requested.minus(balance).toFixed(),
    });
  }
}

export async function lockWallet(walletId: string, t: Transaction): Promise<Wallet> {
  const wallet = await Wallet.findByPk(walletId, { transaction: t, lock: t.LOCK.UPDATE });
  if (!wallet) throw new NotFoundError('wallet', walletId);
  return wallet;
}

export async function lockWalletByMemberId(memberId: string, t: Transaction): Promise<Wallet> {
  const wallet = await Wallet.findOne({ where: { memberId }, transaction: t, lock: t.LOCK.UPDATE });
  if (!wallet) throw new NotFoundError('wallet for member', memberId);
  return wallet;
}

export interface BalanceChange {
  kind: WalletTxKind;
  /** Signed. Credits positive, debits negative. */
  delta: BigNumber;
  reference?: { type: WalletTxReferenceType; id: string };
  turnoverAccrued?: BigNumber;
  turnoverRequired?: BigNumber;
}

export async function applyBalanceChange(
  wallet: Wallet,
  change: BalanceChange,
  t: Transaction,
): Promise<{ wallet: Wallet; entry: WalletTx }> {
  if (change.delta.isZero()) {
    throw new Error('refusing to write a zero-amount ledger entry');
  }
  const before = dec(wallet.balance);
  const after = before.plus(change.delta);
  if (after.isLessThan(ZERO)) {
    throw new InsufficientBalanceError(before, change.delta.negated());
  }

  const entry = await WalletTx.create(
    {
      walletId: wallet.id,
      kind: change.kind,
      amount: toMoneyString(change.delta),
      balanceAfter: toMoneyString(after),
      referenceType: change.reference?.type ?? null,
      referenceId: change.reference?.id ?? null,
    },
    { transaction: t },
  );

  wallet.balance = toMoneyString(after);
  wallet.turnoverAccrued = toMoneyString(dec(wallet.turnoverAccrued).plus(change.turnoverAccrued ?? ZERO));
  wallet.turnoverRequired = toMoneyString(dec(wallet.turnoverRequired).plus(change.turnoverRequired ?? ZERO));
  await wallet.save({ transaction: t });

  return { wallet, entry };
}

// Rebuilds the balance from the ledger alone. For tests and reconciliation.
export async function reconstructBalance(walletId: string): Promise<BigNumber> {
  const rows = await WalletTx.findAll({ where: { walletId }, order: [['seq', 'ASC']] });
  let running = ZERO;
  for (const row of rows) {
    running = running.plus(dec(row.amount));
    if (!running.isEqualTo(dec(row.balanceAfter))) {
      throw new Error(`ledger gap at wallet_txs.seq=${row.seq}: expected ${running.toFixed()}, row says ${row.balanceAfter}`);
    }
  }
  return running;
}
