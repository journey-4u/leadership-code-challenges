import { createApp } from '../src/app';
import { Wallet, WalletTx } from '../src/db/models';
import { dec } from '../src/lib/money';
import { reconstructBalance } from '../src/services/ledgerService';
import { createMember, fundWallet, useDatabase, wager, withdraw } from './helpers';

const app = createApp();
useDatabase();

describe('ledger', () => {
  it('reconstructs the balance from wallet_txs after a mixed history', async () => {
    const { memberId, walletId } = await createMember(app);
    await fundWallet(app, memberId, '100', 1);
    await wager(app, walletId, '12.5');
    await wager(app, walletId, '87.5');
    await fundWallet(app, memberId, '0.000000000000000001', 0);
    await fundWallet(app, memberId, '20', 0);
    await withdraw(app, memberId, '7.25');
    await wager(app, walletId, '1000');

    const wallet = await Wallet.findByPk(walletId);
    const rebuilt = await reconstructBalance(walletId);
    expect(rebuilt.isEqualTo(dec(wallet!.balance))).toBe(true);
    expect(rebuilt.toFixed()).toBe('12.750000000000000001');

    const rows = await WalletTx.findAll({ where: { walletId }, order: [['seq', 'ASC']] });
    expect(rows.map((r) => r.kind)).toEqual(['deposit', 'wager', 'wager', 'deposit', 'deposit', 'withdrawal']);
  });

  it('the database refuses a second ledger entry for the same funding transaction', async () => {
    const { memberId, walletId } = await createMember(app);
    const depositId = await fundWallet(app, memberId, '10');
    const existing = await WalletTx.findOne({ where: { walletId } });

    await expect(
      WalletTx.create({
        walletId,
        kind: 'deposit',
        amount: '10',
        balanceAfter: '20',
        referenceType: 'funding_transaction',
        referenceId: depositId,
      }),
    ).rejects.toMatchObject({ name: 'SequelizeUniqueConstraintError' });
    expect(existing?.referenceId).toBe(depositId);
  });

  it('the database refuses a negative wallet balance', async () => {
    const { walletId } = await createMember(app);
    await expect(Wallet.update({ balance: '-1' }, { where: { id: walletId } })).rejects.toThrow(/wallets_balance_nonneg/);
  });
});
