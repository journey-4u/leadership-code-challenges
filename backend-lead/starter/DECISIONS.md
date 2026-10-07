# DECISIONS

Notes on the choices I made and why. Read this alongside `src/services/ledgerService.ts` and `src/services/pspCallbackService.ts`, that is where most of it lives.

## Locking

I went with pessimistic row locks (`SELECT ... FOR UPDATE`) on Postgres' default READ COMMITTED level.

Why not optimistic locking with a version column: on this system collisions on one wallet are normal, not rare. A player hammering the bet button, a PSP retrying a callback. With optimistic locking every collision becomes a retry loop and the duplicate-callback case gets harder to reason about. With a row lock the second request just waits, then sees what the first one did.

Why not SERIALIZABLE: it would work, but then every endpoint needs retry handling for serialization failures, and the next person touching the code has to understand that. "Lock the row you're about to change" is easier to keep in your head. READ COMMITTED is enough here because Postgres re-reads the row after a FOR UPDATE wait, so the waiting request sees the committed version. That re-read is what makes the duplicate callback path work: the second delivery sees `status = Completed` and returns `applied: false`.

Lock order is always the same: funding transaction row first, then wallet row. The callback handler locks both in that order. Wagers and withdrawals only lock the wallet. Nothing locks a wallet and then a funding transaction, so there is no way to form a deadlock cycle. There is a comment at the top of `ledgerService.ts` saying this.

One thing I don't like: `applyBalanceChange` relies on the caller having locked the wallet, and nothing enforces that. With more time I'd use a branded `LockedWallet` type that only `lockWallet()` can produce.

A busy wallet serializes on its row. For a player wallet that's fine, operations on one wallet should be ordered anyway. It doesn't block other wallets.

## Schema

**funding_transactions**: deposits and withdrawals in one table with a `type` column. They have the same lifecycle (Pending then a terminal state), the same amount/member fields, and ops needs to look both up the same way. Two tables with a shared state machine didn't buy anything. I store both `amount` (what the member asked for) and `psp_amount` (what the PSP said) so a mismatch is visible on the row.

**wallet_txs**: the ledger. Signed `amount`, `balance_after`, a `seq` bigserial for ordering (created_at can tie), and `reference_type`/`reference_id` pointing at what caused the entry. No `updated_at`, and no code updates or deletes rows. `balance_after` is redundant with the running sum but it lets `reconstructBalance()` tell you which row is wrong instead of just "totals don't match". In production I'd also revoke UPDATE/DELETE on the table from the app role.

The partial unique index on `wallet_txs (reference_type, reference_id)` is the thing I'd point to first. It means a second credit for the same deposit can't be committed at all. If the locking code has a bug, you get a 500 instead of a double credit. There's a test in `ledger.test.ts` that bypasses the service layer and checks this directly.

**Turnover counters on wallets** (`turnover_required`, `turnover_accrued`) instead of computing them per request. They're updated under the same wallet lock as the balance so they're as consistent as the balance, and both can be rebuilt: required is the sum of `amount * turnover_multiplier` over completed deposits, accrued is the sum of wager debits. Computing on every withdrawal would mean scanning the ledger while holding a lock.

Statuses are `STRING` with a CHECK constraint, not Postgres enums. Adding a status is one ALTER, and the TypeScript type is the source of truth.

Money: DECIMAL(36,18), strings at the boundary, BigNumber in between, as the starter says. I added `toMoneyString()` (always 18 places) so what we write matches what pg returns, and input validation caps at 18 fractional digits so nothing gets rounded on the way in.

## The callback

The state machine is in `src/domain/fundingTransactionState.ts` and is the only place that knows the transitions:

```
Pending -> Completed   wallet credited, turnover requirement added
Pending -> Failed      nothing credited
Pending -> Flagged     nothing credited, human looks at it
```

Terminal states are terminal. If ops needs to resolve a Flagged deposit, that's a separate audited operation, not a status edit.

What the handler does with each case:

- First `completed`, amount matches: credit, 200, `applied: true`.
- Same outcome delivered again: 200, `applied: false`. The PSP needs a 2xx or it keeps retrying.
- Callback contradicts a terminal state (`completed` after `Failed`, `failed` after `Completed`): 409. I don't want to silently ack a contradiction. A PSP that keeps retrying a 409 shows up in alerting, which is what I want.
- `completed` with a different amount: deposit goes to `Flagged`, nothing credited, 200. More below.
- Unknown pspRef: 404. We generate the ref inside the deposit's transaction, so a real callback can't arrive before the ref exists. A 404 here is a PSP bug or someone probing.
- `failed`: deposit goes to `Failed`. The amount on a failure doesn't mean anything, so a retried failure with a different amount still counts as a replay.

On the amount mismatch: I added a fourth state instead of using `Failed` because "money arrived but not the amount we expected" is neither a success nor a failure, and calling it Failed would hide the problem. Crediting the requested amount means possibly inventing money we didn't get. Crediting the PSP's amount means a PSP bug or a forged callback decides our liabilities. Neither is acceptable here. So nothing is credited, both amounts stay on the row with a `status_reason`, and someone reconciles against the settlement report. I didn't build that part.

## Wagers and withdrawals

A wager is just a ledger entry with `kind = 'wager'`. A separate table wouldn't hold anything the ledger row doesn't. Turnover accrual is the wager amount, applied in the same call.

Withdrawals debit immediately and create a Pending withdrawal transaction that the ledger entry references. Debiting now means the member can't wager money that's about to be paid out. If a human later rejects the withdrawal, the refund is a new ledger entry pointing at the same transaction, never a delete.

The turnover check runs under the wallet lock, so it can't race with a deposit completing. I didn't make withdrawals consume turnover, the brief says `accrued >= required` and I kept it literal. A real product probably resets both on withdrawal, which is a one-line change in the same locked block.

`turnoverMultiplier` is capped at 1000. Arbitrary, but an unbounded multiplier is an easy way to create a requirement nobody can meet.

## Tests

Everything runs against real Postgres through HTTP. The things that matter (row locks, constraints, the re-read after a FOR UPDATE wait) don't exist in a mock. The concurrency tests fire 10 to 20 requests at once and check the exact number of successes, the final balance, the ledger length, and that the ledger rebuilds to the balance. Two tests in `ledger.test.ts` skip the service layer on purpose to show the database rejects a duplicate credit and a negative balance by itself.

Not tested: shape of 400 bodies, and deadlocks (there's no lock cycle to provoke).

## Next, if I had more time

1. Signature verification and an adapter boundary on the callback route. See `DESIGN-PSP.md`. Right now the mock PSP's shape is parsed straight in the route.
2. Idempotency keys for wagers and withdrawals. A client retrying `POST /wagers` after a timeout currently places two bets. The ledger already has the reference columns for it.
3. The `LockedWallet` branded type mentioned above.
4. A nightly job that runs `reconstructBalance()` and the turnover rebuild over all wallets and pages on drift.
5. Withdrawal approve/reject with the refund path, and the ops action that resolves Flagged deposits.
6. Metrics per callback outcome (applied, replay, 409, 404, flagged). 409 and 404 rates are the fastest way to spot a broken PSP.
7. Rate limiting on the callback route, since a PSP retrying a 409 forever is load we cause ourselves.

## AI disclosure

I used Claude Code (Anthropic) for this submission. It wrote the migrations, models, services, routes, tests, and these two documents from the brief, and ran the suite against Postgres while iterating. My part was review: I traced the callback and ledger paths end to end, removed the FOR UPDATE lock and the ledger unique index one at a time to confirm the concurrency tests catch each, and went through every decision listed above. I kept all of them, including 409 for contradictory callbacks, and I'm the one answering for them in the interview.
