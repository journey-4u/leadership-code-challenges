import { Router } from 'express';
import { z } from 'zod';
import * as withdrawalService from '../services/withdrawalService';
import { positiveMoney, uuid } from '../lib/validation';

export const withdrawalsRouter = Router();

const createWithdrawalBody = z.object({
  memberId: uuid,
  amount: positiveMoney,
});

withdrawalsRouter.post('/', async (req, res, next) => {
  try {
    const body = createWithdrawalBody.parse(req.body);
    const { transaction, wallet } = await withdrawalService.createWithdrawal(body);
    res.status(201).json({
      id: transaction.id,
      status: transaction.status,
      amount: transaction.amount,
      balance: wallet.balance,
    });
  } catch (err) {
    next(err);
  }
});
