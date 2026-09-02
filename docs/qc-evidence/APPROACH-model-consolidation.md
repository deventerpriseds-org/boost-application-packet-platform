<!--
WHAT:       How to make the LLM model ONE owner-settable value instead of 43 literals across 32
            files, and why the sweep is deferred rather than done now.
WHY:        Owner, 2026-09-01, asked to switch the coverage judge to a newer model; the sweep that
            found where to put the setting found the model hardcoded everywhere. Owner: "we'll hold
            off on the model change. document the approach to consolidate and track it to do when we
            finish the other higher priority items. for now it can continue using the model the
            prompt does now, ie gpt4o".
SUPERSEDES: nothing.
SUPERSEDED-BY: nothing -- current.
EVIDENCE:   measured 2026-09-01 by grep over api/src/functions/tests/*.ts; counts below are that
            command's output, not an estimate.
-->

# Model consolidation — the approach, and why it waits

## MEASURED — the model is a literal in 32 files

```
$ grep -rl "'gpt-4o'\|'gpt-4o-mini'" api/src/functions/tests/*.ts | wc -l
32

$ grep -rh "model: '[^']*'" api/src/functions/tests/*.ts | grep -o "model: '[^']*'" | sort | uniq -c
     34 model: 'gpt-4o-mini'
      9 model: 'gpt-4o'
      4 model: 'text-embedding-3-small'
      2 model: 'gpt-4o (vision)'
      1 model: 'turn_v3'
      1 model: 'eleven_turbo_v2_5'
```

`appApply`, `appCapture`, `appConvai`, `appConvert`, `appExtras`, `appJdParse`, `appOutreach` and
25 more. **`checkPrefs.ts` has no model column at all.**

**So "switch to a new model" is 43 edits today, not a setting** — which is a direct violation of
`CLAUDE.md`'s *"never hardcode a configurable value in code only"*, at scale, and it is why the
question "can we use a different model" could not be answered with a toggle.

## THE DECISION — deferred, deliberately, and here is the standing state

- **The coverage judge uses `gpt-4o`**, the same model the pipeline's own calls use. No new model is
  introduced by the judge work.
- **The consolidation is tracked, not started.** It runs after the UI parity rows and the judge.
- **Nothing about the judge's design depends on this.** Its model arrives as a parameter either way;
  today that parameter is filled from the same literal, tomorrow from a setting. The judge does not
  need to be rewritten when this lands.

## THE APPROACH, when it runs

**Tier 2** — routes and transports, no path to a gate or a score. Implement, test, mutation-prove
the new guard. No AC subagent, no verifier.

### 1. One source, seeded from today's literals

Extend the EXISTING config, do not add a store. Two homes already exist and the choice between them
is the first thing to settle:

| candidate home | what already lives there | fits? |
|---|---|---|
| `AppConfig` `CONFIG_KEYS` (`config.ts`) | the ten pipeline settings — temperatures, template ids, folders — already rendered by **Settings ▸ Quality ▸ Pipeline** from the API's own key list | **likely yes** — model is a pipeline setting of exactly this shape, and the screen builds itself from the key list, so a new key appears with no UI work |
| `checkPrefs` `chk_*` columns | the eleven quality thresholds, per owner | only if the model must vary per owner |

**Recommendation: `CONFIG_KEYS`.** The Settings screen renders from the API's key list rather than a
hand-written form, so adding the key is most of the feature.

### 2. Seed with what each call site uses TODAY, so nothing changes on the day it lands

Not one global default — **the calls are not all the same tier**. `gpt-4o-mini` on JD parsing and
`gpt-4o` on conversion are a real distinction, and collapsing them to a single value would be a
behaviour change smuggled inside a refactor. So: a small number of NAMED roles, each seeded to its
current literal.

```
openai.model.cheap    = 'gpt-4o-mini'   // parsing, capture, outreach -- 34 sites
openai.model.quality  = 'gpt-4o'        // conversion, extras, the coverage judge -- 9 sites
openai.model.embed    = 'text-embedding-3-small'
```

**The embedding model is NOT interchangeable with the chat models** and must stay its own key — a
chat model in that slot returns a 400, and vectors written under one embedding model are not
comparable with another's, so changing it invalidates stored embeddings. Say so at the key.

### 3. Free text, never a dropdown

The identifier is the provider's, it changes without warning, and this session could not name a
model released after its own knowledge cutoff. **A dropdown means a code change every time a model
ships.** Free text with the provider's error surfaced verbatim on a bad value is both simpler and
more honest than a list that goes stale.

### 4. The guard, and its mutation

`H:model-comes-from-config` — a source grep asserting **no `model: '<literal>'` remains** in
`api/src/functions/tests/*.ts` outside the seed definition. Structural, because this is exactly the
class a runtime test cannot express (H-rule 4).

**Mutation:** reinstate one literal at a call site and confirm the suite fails. Without that, the
guard is a comment.

### 5. Order, and the one real risk

Do it as **one sweep, one commit**, not file-by-file: a half-converted state is worse than either
end, because two call sites would then read the model from two different places and nobody could
tell which was authoritative from the code.

**The risk worth naming:** 43 mechanical edits across 32 files is exactly the shape where a
find-and-replace silently changes a string it should not — `'gpt-4o (vision)'` is a LOG LABEL, not a
model argument, and a blind replace would corrupt the usage ledger. Convert by call site, and keep
`logUsage`'s label reading whatever was actually sent.

## WHAT IS TRUE TODAY, so nobody re-derives it

- The judge, and every other call, runs on the literals above. **Nothing is broken and nothing is
  waiting on this** — it is a maintainability and self-service defect, not a runtime one.
- **A model change requested before this lands is a code change**, and should be quoted as such
  rather than as a settings edit.
