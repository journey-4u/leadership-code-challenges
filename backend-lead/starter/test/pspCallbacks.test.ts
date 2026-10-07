import { createApp } from '../src/app';
import { FundingTransaction, WalletTx } from '../src/db/models';
import { reconstructBalance } from '../src/services/ledgerService';
import { createDeposit, createMember, getWallet, money, sendCallback, useDatabase } from './helpers';

const app = createApp();
useDatabase();

describe('POST /psp/callbacks', () => {
  it('credits the wallet exactly once and writes one ledger entry', async () => {
    const { memberId, walletId } = await createMember(app);
    const dep = await createDeposit(app, memberId, '100.50', 3);

    const res = await sendCallback(app, dep.pspRef, '100.50');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ transactionId: dep.id, status: 'Completed', applied: true });

    const wallet = await getWallet(app, memberId);
    expect(wallet.balance).toBe(money('100.50'));
    expect(wallet.turnoverRequired).toBe(money('301.50'));

    const ledger = await WalletTx.findAll({ where: { walletId } });
    expect(ledger).toHaveLength(1);
    expect(ledger[0].kind).toBe('deposit');
    expect(ledger[0].referenceId).toBe(dep.id);
    expect((await reconstructBalance(walletId)).toFixed()).toBe('100.5');
  });

  it('a duplicate callback delivered later does not double-credit', async () => {
    const { memberId, walletId } = await createMember(app);
    const dep = await createDeposit(app, memberId, '40');

    const first = await sendCallback(app, dep.pspRef, '40');
    const second = await sendCallback(app, dep.pspRef, '40');
    const third = await sendCallback(app, dep.pspRef, '40');

    expect(first.body.applied).toBe(true);
    expect(second.status).toBe(200);
    expect(second.body).toEqual({ transactionId: dep.id, status: 'Completed', applied: false });
    expect(third.body.applied).toBe(false);

    expect((await getWallet(app, memberId)).balance).toBe(money('40'));
    expect(await WalletTx.count({ where: { walletId } })).toBe(1);
  });

  it('concurrent duplicate callbacks do not double-credit', async () => {
    const { memberId, walletId } = await createMember(app);
    const dep = await createDeposit(app, memberId, '25');

    const N = 12;
    const results = await Promise.all(Array.from({ length: N }, () => sendCallback(app, dep.pspRef, '25')));

    const statuses = results.map((r) => r.status);
    expect(statuses.every((s) => s === 200)).toBe(true);
    const applied = results.filter((r) => r.body.applied === true);
    expect(applied).toHaveLength(1);

    expect((await getWallet(app, memberId)).balance).toBe(money('25'));
    expect(await WalletTx.count({ where: { walletId } })).toBe(1);
    expect((await reconstructBalance(walletId)).toFixed()).toBe('25');
  });

  it('a failed callback moves the deposit to Failed and credits nothing', async () => {
    const { memberId, walletId } = await createMember(app);
    const dep = await createDeposit(app, memberId, '10');

    const res = await sendCallback(app, dep.pspRef, '10', 'failed');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('Failed');

    expect((await getWallet(app, memberId)).balance).toBe(money('0'));
    expect(await WalletTx.count({ where: { walletId } })).toBe(0);
    expect((await FundingTransaction.findByPk(dep.id))?.statusReason).toBe('psp_reported_failure');

    const replay = await sendCallback(app, dep.pspRef, '0.01', 'failed');
    expect(replay.status).toBe(200);
    expect(replay.body.applied).toBe(false);
  });

  it('rejects a completed callback after a failed one (invalid transition)', async () => {
    const { memberId } = await createMember(app);
    const dep = await createDeposit(app, memberId, '10');

    await sendCallback(app, dep.pspRef, '10', 'failed');
    const res = await sendCallback(app, dep.pspRef, '10', 'completed');

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('invalid_transition');
    expect(res.body).toMatchObject({ from: 'Failed', to: 'Completed' });
    expect((await getWallet(app, memberId)).balance).toBe(money('0'));
  });

  it('rejects a failed callback after a completed one and keeps the credit', async () => {
    const { memberId } = await createMember(app);
    const dep = await createDeposit(app, memberId, '10');

    await sendCallback(app, dep.pspRef, '10', 'completed');
    const res = await sendCallback(app, dep.pspRef, '10', 'failed');

    expect(res.status).toBe(409);
    expect((await getWallet(app, memberId)).balance).toBe(money('10'));
    expect((await FundingTransaction.findByPk(dep.id))?.status).toBe('Completed');
  });

  it('flags an amount mismatch instead of crediting either amount', async () => {
    const { memberId, walletId } = await createMember(app);
    const dep = await createDeposit(app, memberId, '100');

    const res = await sendCallback(app, dep.pspRef, '99.99');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('Flagged');

    const row = await FundingTransaction.findByPk(dep.id);
    expect(row?.statusReason).toBe('amount_mismatch');
    expect(row?.amount).toBe(money('100'));
    expect(row?.pspAmount).toBe(money('99.99'));

    expect((await getWallet(app, memberId)).balance).toBe(money('0'));
    expect(await WalletTx.count({ where: { walletId } })).toBe(0);

    const retry = await sendCallback(app, dep.pspRef, '100');
    expect(retry.status).toBe(409);
    const replay = await sendCallback(app, dep.pspRef, '99.99');
    expect(replay.status).toBe(200);
    expect(replay.body.applied).toBe(false);
  });

  it('returns 404 for an unknown pspRef', async () => {
    const res = await sendCallback(app, 'dep_doesnotexist', '1');
    expect(res.status).toBe(404);
  });

  it('rejects malformed callbacks', async () => {
    const { memberId } = await createMember(app);
    const dep = await createDeposit(app, memberId, '10');
    const res = await sendCallback(app, dep.pspRef, '10', 'done' as never);
    expect(res.status).toBe(400);
  });
});
