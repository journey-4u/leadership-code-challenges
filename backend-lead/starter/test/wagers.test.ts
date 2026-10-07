import { createApp } from '../src/app';
import { WalletTx } from '../src/db/models';
import { dec } from '../src/lib/money';
import { reconstructBalance } from '../src/services/ledgerService';
import { createMember, fundWallet, getWallet, money, useDatabase, wager } from './helpers';

const app = createApp();
useDatabase();

describe('POST /wallets/:walletId/wagers', () => {
  it('debits the wallet, accrues turnover and writes a ledger entry', async () => {
    const { memberId, walletId } = await createMember(app);
    await fundWallet(app, memberId, '100', 2);

    const res = await wager(app, walletId, '10.25');
    expect(res.status).toBe(201);
    expect(res.body.balance).toBe(money('89.75'));
    expect(res.body.turnoverAccrued).toBe(money('10.25'));
    expect(res.body.turnoverRequired).toBe(money('200'));

    const entries = await WalletTx.findAll({ where: { walletId, kind: 'wager' } });
    expect(entries).toHaveLength(1);
    expect(entries[0].amount).toBe('-' + money('10.25'));
    expect(entries[0].balanceAfter).toBe(money('89.75'));
  });

  it('rejects a wager that exceeds the balance', async () => {
    const { memberId, walletId } = await createMember(app);
    await fundWallet(app, memberId, '5');

    const res = await wager(app, walletId, '5.01');
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('insufficient_balance');
    expect(res.body.shortfall).toBe('0.01');

    expect((await getWallet(app, memberId)).balance).toBe(money('5'));
    expect(await WalletTx.count({ where: { walletId, kind: 'wager' } })).toBe(0);
  });

  it('allows a wager equal to the full balance', async () => {
    const { memberId, walletId } = await createMember(app);
    await fundWallet(app, memberId, '5');
    const res = await wager(app, walletId, '5');
    expect(res.status).toBe(201);
    expect(res.body.balance).toBe(money('0'));
  });

  it('concurrent wagers cannot overdraw the wallet', async () => {
    const { memberId, walletId } = await createMember(app);
    await fundWallet(app, memberId, '50');

    const results = await Promise.all(Array.from({ length: 20 }, () => wager(app, walletId, '10')));

    const ok = results.filter((r) => r.status === 201);
    const rejected = results.filter((r) => r.status === 422);
    expect(ok).toHaveLength(5);
    expect(rejected).toHaveLength(15);
    expect(ok.length + rejected.length).toBe(results.length);

    const wallet = await getWallet(app, memberId);
    expect(wallet.balance).toBe(money('0'));
    expect(wallet.turnoverAccrued).toBe(money('50'));

    const ledger = await WalletTx.findAll({ where: { walletId }, order: [['seq', 'ASC']] });
    expect(ledger).toHaveLength(6); // 1 deposit + 5 wagers
    expect((await reconstructBalance(walletId)).isEqualTo(dec(wallet.balance))).toBe(true);
    const afters = ledger.slice(1).map((e) => dec(e.balanceAfter).toNumber());
    expect(afters).toEqual([40, 30, 20, 10, 0]);
  });

  it('returns 404 for an unknown wallet', async () => {
    const res = await wager(app, '00000000-0000-4000-8000-000000000000', '1');
    expect(res.status).toBe(404);
  });
});
