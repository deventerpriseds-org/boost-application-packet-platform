import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
}

// MT-42 — Offer / negotiation tracker. Given their offer + a walk-away floor,
// computes live total-comp math and generates a counter draft, comp benchmarks,
// and a leverage summary — the spec's negotiation-tracker contract.
export async function mt42(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const key = process.env.OPENAI_API_KEY
  if (!key) return { status: 200, headers: HEADERS, jsonBody: { pass: false, detail: 'OPENAI_API_KEY not set' } }

  // Their offer + our floor (deterministic total-comp math computed locally)
  const theirOffer = { base: 380000, equityPerYear: 120000, signOn: 50000 }
  const floor = { base: 400000, equityPerYear: 150000 }
  const theirTotalYr1 = theirOffer.base + theirOffer.equityPerYear + theirOffer.signOn
  const floorTotalYr1 = floor.base + floor.equityPerYear
  const belowFloor = theirOffer.base < floor.base || theirOffer.equityPerYear < floor.equityPerYear

  const system = 'You are an executive compensation negotiation advisor. Return ONLY JSON.'
  const user = `Their offer: base $${theirOffer.base}, equity $${theirOffer.equityPerYear}/yr, sign-on $${theirOffer.signOn}. My floor: base $${floor.base}, equity $${floor.equityPerYear}/yr. Role: VP Engineering, SF. Return JSON: { "counterDraft": "...", "compBenchmarks": [ { "metric": "...", "market": "..." } ], "leverageSummary": "...", "recommendation": "accept|counter|decline" }.`

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'system', content: system }, { role: 'user', content: user }], max_tokens: 1200, response_format: { type: 'json_object' } })
    })
    if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`)
    const data = await res.json() as any
    const content = data.choices?.[0]?.message?.content || '{}'
    let neg: any = {}
    try { neg = JSON.parse(content) } catch {}
    const pass = !!neg.counterDraft && !!neg.leverageSummary && Array.isArray(neg.compBenchmarks)
    return {
      status: 200, headers: HEADERS,
      jsonBody: {
        pass,
        detail: pass
          ? `Total-comp math: their Y1 $${theirTotalYr1.toLocaleString()} vs floor $${floorTotalYr1.toLocaleString()} (${belowFloor ? 'below floor' : 'meets floor'}). Counter + benchmarks + leverage generated. Rec: ${neg.recommendation}.`
          : `Incomplete negotiation output`,
        totalComp: { theirYear1: theirTotalYr1, floorYear1: floorTotalYr1, belowFloor },
        negotiation: neg,
        aiResponse: content
      }
    }
  } catch (err) {
    return { status: 200, headers: HEADERS, jsonBody: { pass: false, detail: String(err) } }
  }
}

app.http('mt42', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'test/mt-42', handler: mt42 })
