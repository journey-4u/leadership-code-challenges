import { Router } from 'express';
import { z } from 'zod';
import * as depositService from '../services/depositService';
import { positiveMoney, uuid } from '../lib/validation';

export const depositsRouter = Router();

const createDepositBody = z.object({
  memberId: uuid,
  amount: positiveMoney,
  turnoverMultiplier: z.number().int().min(0).max(1000).default(1),
});

depositsRouter.post('/', async (req, res, next) => {
  try {
    const body = createDepositBody.parse(req.body);
    const txn = await depositService.createDeposit(body);
    res.status(201).json({
      id: txn.id,
      pspRef: txn.pspRef,
      status: txn.status,
      amount: txn.amount,
      turnoverMultiplier: txn.turnoverMultiplier,
    });
  } catch (err) {
    next(err);
  }
});
