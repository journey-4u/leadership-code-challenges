import { Router } from 'express';
import { z } from 'zod';
import * as pspCallbackService from '../services/pspCallbackService';
import { positiveMoney } from '../lib/validation';

export const pspCallbacksRouter = Router();

// Mock PSP payload shape. Real providers would be normalised first, see DESIGN-PSP.md.
const callbackBody = z.object({
  pspRef: z.string().min(1).max(64),
  status: z.enum(['completed', 'failed']),
  amount: positiveMoney,
});

pspCallbacksRouter.post('/', async (req, res, next) => {
  try {
    const body = callbackBody.parse(req.body);
    const result = await pspCallbackService.handlePspCallback(body);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});
