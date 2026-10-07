import { createApp } from '../src/app';
import { FundingTransaction, WalletTx } from '../src/db/models';
import { reconstructBalance } from '../src/services/ledgerService';
import { createMember, fundWallet, getWallet, money, sendCallback, createDeposit, useDatabase, wager, withdraw } from './helpers';

const app = createApp();
useDatabase();

describe('POST /withdrawals', () => {
  it('blocks withdrawal while turnover is outstanding and reports the shortfall', async () => {
    const { memberId, walletId } = await createMember(app);
    await fundWallet(app, memberId, '100', 2);
    await wager(app, walletId, '30');

    const res = await withdraw(app, memberId, '10');
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('turnover_locked');
    expect(res.body.turnoverRequired).toBe('200');
    expect(res.body.turnoverAccrued).toBe('30');
    expect(res.body.outstandingTurnover).toBe('170');

    expect((await getWallet(app, memberId)).balance).toBe(money('70'));
    expect(await FundingTransaction.count({ where: { walletId, type: 'withdrawal' } })).toBe(0);
  });

  it('unblocks exactly at the requirement and debits immediately', async () => {
    const { memberId, walletId } = await createMember(app);
    await fundWallet(app, memberId, '100', 1);
    await wager(app, walletId, '60');
    expect((await withdraw(app, memberId, '10')).status).toBe(422);
    await wager(app, walletId, '40');

    await fundWallet(app, memberId, '50', 0);
    const res = await withdraw(app, memberId, '30');
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('Pending');
    expect(res.body.amount).toBe(money('30'));
    expect(res.body.balance).toBe(money('20'));

    const txn = await FundingTransaction.findByPk(res.body.id);
    expect(txn?.type).toBe('withdrawal');
    expect(txn?.status).toBe('Pending');
    expect(txn?.pspRef).toBeNull();

    const entry = await WalletTx.findOne({ where: { walletId, kind: 'withdrawal' } });
    expect(entry?.amount).toBe('-' + money('30'));
    expect(entry?.referenceId).toBe(res.body.id);
    expect((await reconstructBalance(walletId)).toFixed()).toBe('20');
  });

  it('a new deposit with a multiplier re-locks withdrawals', async () => {
    const { memberId, walletId } = await createMember(app);
    await fundWallet(app, memberId, '10', 1);
    await wager(app, walletId, '10');
    await fundWallet(app, memberId, '20', 0);
    expect((await withdraw(app, memberId, '5')).status).toBe(201);

    await fundWallet(app, memberId, '10', 5);
    const res = await withdraw(app, memberId, '5');
    expect(res.status).toBe(422);
    expect(res.body.outstandingTurnover).toBe('50');
  });

  it('a Pending or Failed deposit adds no turnover requirement', async () => {
    const { memberId } = await createMember(app);
    await fundWallet(app, memberId, '10', 0);
    const pending = await createDeposit(app, memberId, '100', 10);
    const failed = await createDeposit(app, memberId, '100', 10);
    await sendCallback(app, failed.pspRef, '100', 'failed');
    expect(pending).toBeTruthy();

    const res = await withdraw(app, memberId, '10');
    expect(res.status).toBe(201);
  });

  it('rejects a withdrawal larger than the balance', async () => {
    const { memberId } = await createMember(app);
    await fundWallet(app, memberId, '10', 0);
    const res = await withdraw(app, memberId, '10.01');
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('insufficient_balance');
    expect((await getWallet(app, memberId)).balance).toBe(money('10'));
  });

  it('concurrent withdrawals cannot overdraw the wallet', async () => {
    const { memberId, walletId } = await createMember(app);
    await fundWallet(app, memberId, '30', 0);

    const results = await Promise.all(Array.from({ length: 10 }, () => withdraw(app, memberId, '10')));
    expect(results.filter((r) => r.status === 201)).toHaveLength(3);
    expect(results.filter((r) => r.status === 422)).toHaveLength(7);
    expect((await getWallet(app, memberId)).balance).toBe(money('0'));
    expect(await FundingTransaction.count({ where: { walletId, type: 'withdrawal' } })).toBe(3);
  });

  it('returns 404 for an unknown member', async () => {
    const res = await withdraw(app, '00000000-0000-4000-8000-000000000000', '1');
    expect(res.status).toBe(404);
  });
});
