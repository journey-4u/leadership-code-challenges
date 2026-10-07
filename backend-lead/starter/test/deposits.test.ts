import request from 'supertest';
import { createApp } from '../src/app';
import { createMember, useDatabase } from './helpers';
import { FundingTransaction } from '../src/db/models';

const app = createApp();
useDatabase();

describe('POST /deposits', () => {
  it('creates a Pending deposit with a pspRef and moves no money', async () => {
    const { memberId } = await createMember(app);
    const res = await request(app)
      .post('/deposits')
      .send({ memberId, amount: '100.50', turnoverMultiplier: 2 });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('Pending');
    expect(res.body.pspRef).toMatch(/^dep_[0-9a-f]{32}$/);
    expect(res.body.turnoverMultiplier).toBe(2);

    const wallet = await request(app).get(`/members/${memberId}/wallet`);
    expect(wallet.body.balance).toBe('0.000000000000000000');
    expect(wallet.body.turnoverRequired).toBe('0.000000000000000000');

    const row = await FundingTransaction.findByPk(res.body.id);
    expect(row?.type).toBe('deposit');
    expect(row?.amount).toBe('100.500000000000000000');
  });

  it('defaults turnoverMultiplier to 1', async () => {
    const { memberId } = await createMember(app);
    const res = await request(app).post('/deposits').send({ memberId, amount: '10' });
    expect(res.status).toBe(201);
    expect(res.body.turnoverMultiplier).toBe(1);
  });

  it.each([
    ['zero', '0'],
    ['negative', '-5'],
    ['number not string', 5],
    ['garbage', 'ten'],
    ['too many decimals', '1.0000000000000000001'],
  ])('rejects a %s amount', async (_label, amount) => {
    const { memberId } = await createMember(app);
    const res = await request(app).post('/deposits').send({ memberId, amount });
    expect(res.status).toBe(400);
  });

  it('rejects a negative or fractional turnoverMultiplier', async () => {
    const { memberId } = await createMember(app);
    expect((await request(app).post('/deposits').send({ memberId, amount: '1', turnoverMultiplier: -1 })).status).toBe(400);
    expect((await request(app).post('/deposits').send({ memberId, amount: '1', turnoverMultiplier: 1.5 })).status).toBe(400);
  });

  it('returns 404 for an unknown member', async () => {
    const res = await request(app)
      .post('/deposits')
      .send({ memberId: '00000000-0000-4000-8000-000000000000', amount: '1' });
    expect(res.status).toBe(404);
  });
});
