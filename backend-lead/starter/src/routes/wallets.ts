import { Router } from 'express';
import { z } from 'zod';
import * as wagerService from '../services/wagerService';
import { positiveMoney, uuid } from '../lib/validation';

export const walletsRouter = Router();

const wagerBody = z.object({ amount: positiveMoney });

walletsRouter.post('/:walletId/wagers', async (req, res, next) => {
  try {
    const walletId = uuid.parse(req.params.walletId);
    const body = wagerBody.parse(req.body);
    const { wallet, entry } = await wagerService.placeWager({ walletId, amount: body.amount });
    res.status(201).json({
      walletTxId: entry.id,
      amount: body.amount,
      balance: wallet.balance,
      turnoverAccrued: wallet.turnoverAccrued,
      turnoverRequired: wallet.turnoverRequired,
    });
  } catch (err) {
    next(err);
  }
});
