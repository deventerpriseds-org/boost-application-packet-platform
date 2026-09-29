#!/usr/bin/env node
// WHAT:       Prints what the role taxonomy ACTUALLY does with a job title -- the group it bins into,
//             the role it resolves, its tier, whether it is a favourite, by which method, and (the
//             part nobody could see before) whether the owner can mute it from Roles & Titles at all.
// WHY:        2026-09-29. Asked why off-target AstraZeneca roles were showing, I read ONE function
//             (`applyLocationPrefs`), found it tests location only, and told the owner "there is no
//             role or title gate anywhere". The owner refuted it: "It's not true that the system
//             don't have roles that match bins and favorites... You need to actually read
//             thoroughly." A full taxonomy existed -- fav/watch/off tiers, owner overrides, a
//             favourites-first sort, four filter chips, a whole Roles & Titles screen. Three separate
//             claims in that reply were wrong. Running the real matcher on the real titles settled
//             every one of them in a single command, AFTER a whole reply spent asserting from a
//             partial read. This script is that command, kept.
//             The prose rule ("never claim absence from a narrow read") was already in CLAUDE.md and
//             in .claude/accuracy-log.md and was broken anyway -- which is why this is a tool.
// SUPERSEDES: nothing
// SUPERSEDED-BY: nothing -- current
// EVIDENCE:   .claude/accuracy-log.md "2026-09-29 - I declared the role-matching system ABSENT after
//             reading ONE chain"; .claude/actions.md ACT:funnel-gates-on-location-but-never-on-role
//
// Usage:  node scripts/explain-title.mjs "Senior Director, Regulatory Affairs Strategy - Cell Therapy"
//         node scripts/explain-title.mjs --stdin   < titles.txt
//
// Reads the BUILT module (api/dist), never the source: the shape the running code uses is the only
// shape worth reporting, and a transpiled namespace is not what you remember.
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { createInterface } from 'node:readline'

const HERE = dirname(fileURLToPath(import.meta.url))
const BUILT = resolve(HERE, '../api/dist/functions/tests/roleTaxonomy.js')

if (!existsSync(BUILT)) {
  console.error(`No built module at ${BUILT}\nRun:  cd api && npm run build`)
  process.exit(2)
}

const require = createRequire(import.meta.url)
const { resolveTitle, normalize, SEED, FAVORITE_BOOST, GROUP_LABEL, seniorityBand } = require(BUILT)

// Every key an owner override could possibly match. `tagFields` looks up the tier map by
// `normalize(title)`, so a title whose normalized form is absent here CANNOT be muted or favourited
// from Roles & Titles -- there is no row to toggle. That was the finding this script exists for.
const SEED_KEYS = new Set(SEED.titles.map((t) => normalize(t.title)))

function explain(raw) {
  const m = resolveTitle(raw)
  const key = normalize(raw)
  const addressable = SEED_KEYS.has(key)
  const score = m.isFavorite ? `base + ${FAVORITE_BOOST}` : 'base (no boost)'
  return [
    `title        ${JSON.stringify(raw)}`,
    `override key ${JSON.stringify(key)}   <- normalize() CUTS at the first comma/dash/paren`,
    `addressable  ${addressable ? 'YES - a taxonomy_title row exists; Roles & Titles can tier it'
                                : 'NO  - no taxonomy_title row with this key, so there is NOTHING to toggle'}`,
    `group        ${m.group ?? 'null'}${m.group ? `  (${GROUP_LABEL[m.group] ?? m.group})` : ''}`,
    `band         ${seniorityBand(raw) ?? 'null'}   <- authoritative for the group bucket`,
    `role         ${m.role ?? 'null'}`,
    `variation    ${m.variation ?? 'null'}`,
    `tier         ${m.tier}${m.tier === 'off' ? '   (NOTE: nothing consumes o.tier -- off hides nothing)' : ''}`,
    `favourite    ${m.isFavorite}   -> match_score = ${score}`,
    `method       ${m.method}   confidence ${m.confidence}${m.backlog ? '   backlog=true' : ''}`,
  ].join('\n')
}

const args = process.argv.slice(2)
if (!args.length) {
  console.error('usage: explain-title.mjs "<job title>" [...]   |   explain-title.mjs --stdin')
  process.exit(2)
}

if (args[0] === '--stdin') {
  const rl = createInterface({ input: process.stdin })
  for await (const line of rl) {
    const t = line.trim()
    if (t) console.log(explain(t) + '\n')
  }
} else {
  console.log(args.map(explain).join('\n\n'))
}
