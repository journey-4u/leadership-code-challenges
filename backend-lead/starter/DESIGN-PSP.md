# DESIGN-PSP: the 50th PSP

Goal: a junior can add a PSP in a day, and the worst they can break is that one PSP. Never the wallet.

## The idea

The wallet never sees a PSP. It sees one canonical event. The only code that knows a provider's format, signature scheme and quirks is a small adapter, and a shared test suite forces every adapter into the same shape. `handlePspCallback()` from Part A already is the provider-agnostic core. This note is about what goes in front of it.

```
 POST /psp/callbacks/:provider
          |  raw body + headers
          v
 +-------------------------+   config per provider (env / secrets)
 | PspRegistry.get(name)   |<-- { secret, amountUnit, statusMap, ... }
 +-----------+-------------+
             v
 +-------------------------+  1. verify(raw)     throws on bad signature
 | PspAdapter<Config>      |  2. parse(raw)      zod, provider shape
 |  (one file per PSP)     |  3. normalize(obj)  -> CanonicalPspEvent
 +-----------+-------------+
             v
 +-------------------------+  psp_callback_log: raw + canonical + provider
 | Callback ingest         |  + dedupe key. Audit trail and replay source.
 +-----------+-------------+
             v
 +-------------------------+  Part A: state machine, locks, ledger.
 | handlePspCallback(ev)   |  Provider-agnostic. Adapters can't bypass it.
 +-------------------------+
```

## The interface

```ts
// Every PSP produces exactly this. Nothing else reaches the wallet.
interface CanonicalPspEvent {
  provider: string;            // 'mockpsp', 'adyen', ...
  pspRef: string;              // our reference, echoed back by the PSP
  providerEventId: string;     // their id for this delivery (dedupe, audit)
  status: 'completed' | 'failed' | 'pending';   // closed vocabulary
  amount: string;              // major units, decimal string, already converted
  currency: string;            // ISO 4217
  occurredAt: Date;
  raw: unknown;                // kept verbatim for the log
}

interface PspAdapter<C = {}> {
  readonly name: string;
  readonly configSchema: z.ZodType<C>;
  verify(req: RawCallback, cfg: C): void;           // HMAC / signature / mTLS, throws
  parse(req: RawCallback): unknown;                 // zod schema for their payload
  normalize(parsed: unknown, cfg: C): CanonicalPspEvent;
  ack(result: IngestResult): { status: number; body: unknown };  // what this PSP wants as a 2xx
}
```

Three rules I'd enforce in review:

- An adapter can't touch the database. No imports from `services/` or `db/`. It's a pure function from bytes to `CanonicalPspEvent`. A bad adapter rejects one provider's callbacks, it can't credit the wrong amount.
- `status` is a closed set. Whatever the provider sends (`SUCCESS`, `captured`, `0000`) gets mapped to three values. `pending` is a no-op in the core, which also handles the "success before pending" quirk: Completed is terminal, so a late pending does nothing.
- Amount conversion happens in the adapter, driven by config (`amountUnit: 'minor' | 'major'`, `minorUnitDigits`), using BigNumber. The core only ever sees major-unit strings and applies the Part A mismatch rule.

## Config

One registry built at startup from a typed config object. Adding a PSP is a new adapter file, a line in the registry, and a config block.

```ts
// src/psp/registry.ts
export const psps = buildRegistry([mockPspAdapter, acmePayAdapter], loadPspConfig());
// loadPspConfig() reads PSP_<NAME>_* from env / secret manager and validates each
// block against adapter.configSchema at boot. A missing secret fails startup, not a callback.
```

Route is `/psp/callbacks/:provider`. Unknown provider is a 404 before any parsing. Secrets come in through `cfg`, never in adapter code. Turning a PSP on or off is config, not a deploy.

## Testing without the real provider

1. A conformance suite every adapter has to pass (`test/psp/conformance.ts`, parametrised by adapter). For each recorded fixture: it verifies, normalizes to a checked-in `expected.json`, status lands in the closed set, minor-unit amounts round-trip exactly. A tampered signature throws. The adapter imports nothing from `db/` or `services/`.
2. Recorded fixtures, not live calls. The adapter ships `fixtures/*.json` (headers + body) captured once from the sandbox with test keys, plus the test secret, so CI actually exercises verification.
3. The hostile-PSP tests are shared. Duplicate, concurrent duplicate, mismatch, out-of-order: tested once against the canonical event in Part A. Every adapter gets them for free.
4. Replay from the callback log. A bad production payload gets copied into `fixtures/` and is a regression test the same day.
5. A sandbox smoke test outside CI (`npm run psp:smoke -- acmepay`), run by hand before enabling the provider. It's allowed to be flaky. CI isn't.

## The one-day checklist

Copy `src/psp/adapters/_template/`. Write `verify` from the provider docs. Write the zod schema. Write `normalize` (status map and amount unit go in config). Capture success, failure and tampered fixtures. Get the conformance suite green. Open the PR. A senior reviews the status map and the signature scheme, the two places provider docs are usually wrong. The wallet code isn't in the diff.
