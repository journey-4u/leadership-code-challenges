import request from 'supertest';
import type { Express } from 'express';
import { sequelize } from '../src/db/sequelize';
import '../src/db/models';

export function useDatabase(): void {
  beforeAll(async () => {
    await sequelize.authenticate();
  });
  beforeEach(async () => {
    await sequelize.truncate({ cascade: true });
  });
  afterAll(async () => {
    await sequelize.close();
  });
}

let counter = 0;

export async function createMember(app: Express): Promise<{ memberId: string; walletId: string }> {
  counter += 1;
  const res = await request(app).post('/members').send({ username: `member${counter}_${Date.now()}` });
  expect(res.status).toBe(201);
  return { memberId: res.body.member.id, walletId: res.body.wallet.id };
}

export async function createDeposit(
  app: Express,
  memberId: string,
  amount: string,
  turnoverMultiplier = 1,
): Promise<{ id: string; pspRef: string }> {
  const res = await request(app).post('/deposits').send({ memberId, amount, turnoverMultiplier });
  expect(res.status).toBe(201);
  return { id: res.body.id, pspRef: res.body.pspRef };
}

export function sendCallback(
  app: Express,
  pspRef: string,
  amount: string,
  status: 'completed' | 'failed' = 'completed',
): request.Test {
  return request(app).post('/psp/callbacks').send({ pspRef, status, amount });
}

export async function fundWallet(
  app: Express,
  memberId: string,
  amount: string,
  turnoverMultiplier = 1,
): Promise<string> {
  const dep = await createDeposit(app, memberId, amount, turnoverMultiplier);
  const cb = await sendCallback(app, dep.pspRef, amount);
  expect(cb.status).toBe(200);
  return dep.id;
}

export async function getWallet(app: Express, memberId: string) {
  const res = await request(app).get(`/members/${memberId}/wallet`);
  expect(res.status).toBe(200);
  return res.body as { id: string; balance: string; turnoverRequired: string; turnoverAccrued: string };
}

export function wager(app: Express, walletId: string, amount: string): request.Test {
  return request(app).post(`/wallets/${walletId}/wagers`).send({ amount });
}

export function withdraw(app: Express, memberId: string, amount: string): request.Test {
  return request(app).post('/withdrawals').send({ memberId, amount });
}

export function money(s: string): string {
  const [int, frac = ''] = s.split('.');
  return `${int}.${frac.padEnd(18, '0')}`;
}
