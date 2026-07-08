// Expanded mock dataset for the Executive Engine clickable prototype.
// Multiple personas × demo states × opportunity catalog.

// Design tokens (re-exported with extras the wireframe data.js did not have)
const PROTO = {
  paper: '#fdfcf7',
  ink: '#1a1a1a',
  ink2: '#555',
  ink3: '#888',
  ink4: '#b3b0a8',
  rule: '#1a1a1a',
  ruleSoft: '#d8d4cc',
  panel: '#f0eeea',
  panelDeep: '#e8e4dc',
  accent: '#3a5fc8',
  accentSoft: '#e8eeff',
  green: '#2d8a4e',
  greenSoft: '#dff0e6',
  red: '#c83a3a',
  redSoft: '#fbe6e6',
  yellow: '#d4a017',
  yellowSoft: '#fbf2da',
  purple: '#8a2d7a',
  purpleSoft: '#f3e6f0',
  orange: '#c87a3a',
  orangeSoft: '#fbece0',
};

// Dark-mode counterparts (only the tokens that need to flip)
const PROTO_DARK = {
  paper: '#1a1916',
  ink: '#f3f0e8',
  ink2: '#b3afa3',
  ink3: '#8a857a',
  ink4: '#4a4640',
  ruleSoft: '#2f2c26',
  panel: '#252320',
  panelDeep: '#2f2c26',
  accentSoft: '#1c2540',
  greenSoft: '#16291d',
  redSoft: '#2e1818',
  yellowSoft: '#2e260f',
  purpleSoft: '#2a1827',
  orangeSoft: '#2a1c0f',
};

// All 12 pipeline stages
const STAGES = [
  { id: 'discovered', label: 'Discovered',          short: 'Disc' },
  { id: 'saved',      label: 'Saved',               short: 'Saved' },
  { id: 'enriched',   label: 'Enriched',            short: 'Enrich' },
  { id: 'applied',    label: 'Applied',             short: 'App' },
  { id: 'outreach',   label: 'Outreach',            short: 'Out' },
  { id: 'engaged',    label: 'Engaged',             short: 'Eng' },
  { id: 'screen',     label: 'Screening',           short: 'Screen' },
  { id: 'r1',         label: 'Round 1',             short: 'R1' },
  { id: 'panel',      label: 'Panel',               short: 'Panel' },
  { id: 'final',      label: 'Final Round',         short: 'Final' },
  { id: 'offer',      label: 'Offer',               short: 'Offer' },
  { id: 'accepted',   label: 'Accepted',            short: 'Won' },
];

// Personas drive which opportunities are surfaced. Each persona has a "master role"
// the engine uses as a baseline + an opportunity catalog.
const PERSONAS = {
  CTO: {
    id: 'CTO',
    label: 'CTO',
    user: { name: 'Jordan Davis',     initials: 'JD', loc: 'SF' },
    masterRole: 'CTO',
    headline: 'CTO — Infra & AI Platform leadership',
    target_comp: '$420–520k + eq',
    why_brand: 'Edge infra at scale · AI platform · cost-optimized modernization',
  },
  VPE: {
    id: 'VPE',
    label: 'VP Engineering',
    user: { name: 'Riley Park',        initials: 'RP', loc: 'NYC' },
    masterRole: 'VP Engineering',
    headline: 'VP Engineering — platform & developer productivity',
    target_comp: '$370–450k + eq',
    why_brand: 'Platform velocity · org scaling · dev-tools depth',
  },
  VPP: {
    id: 'VPP',
    label: 'VP Product',
    user: { name: 'Sam Cohen',         initials: 'SC', loc: 'Remote' },
    masterRole: 'VP Product',
    headline: 'VP Product — risk, ops, and growth platforms',
    target_comp: '$340–410k + eq',
    why_brand: 'Risk product · multi-sided platforms · operator-PM',
  },
};

// Opportunity catalog — 24 opps spanning roles, urgency, stages.
// Each opp has a "rolesFor" array so we can filter by persona.
const ALL_OPPS = [
  // CTO-leaning
  { id: 1,  company: 'Cloudflare',   logo: 'C', role: 'CTO, Infrastructure Modernization', loc: 'SF / Remote',  comp: '$420–520k + eq', match: 94, fit: 'Strategic', urgency: 'Hot',  source: 'LinkedIn',  sourceDate: 'Today, 7:42am', why: 'AI infra + platform modernization + your edge background', hm: 'D. Henry', recruiter: '—', rolesFor: ['CTO'] },
  { id: 2,  company: 'Ramp',         logo: 'R', role: 'CTO',                                loc: 'NYC',          comp: '$450–550k + eq', match: 90, fit: 'Strategic', urgency: 'Hot',  source: 'Recruiter', sourceDate: '2 days ago',    why: 'Fintech platform scale + AI underwriting', hm: '—', recruiter: 'James R. (Russell Reynolds)', rolesFor: ['CTO'] },
  { id: 3,  company: 'Snowflake',    logo: 'S', role: 'Head of Digital Strategy',           loc: 'Remote',       comp: '$310–380k + eq', match: 84, fit: 'Good',      urgency: 'Warm', source: 'Recruiter', sourceDate: 'Yesterday',     why: 'Platform modernization charter, board exposure', hm: '—', recruiter: 'Sarah K. (Heidrick)', rolesFor: ['CTO','VPE'] },
  { id: 4,  company: 'MongoDB',      logo: 'M', role: 'VP Engineering, Platform',           loc: 'NYC / Remote', comp: '$370–450k + eq', match: 76, fit: 'Stretch',   urgency: 'Cool', source: 'LinkedIn',  sourceDate: 'Yesterday',     why: 'Platform scale, DB infra', hm: '—', recruiter: '—', rolesFor: ['CTO','VPE'] },
  { id: 5,  company: 'Coinbase',     logo: 'B', role: 'CTO, Wallet Platform',               loc: 'Remote',       comp: '$430–530k + eq', match: 81, fit: 'Stretch',   urgency: 'Warm', source: 'Recruiter', sourceDate: '3 days ago',    why: 'Crypto infra + custody platform · board reporting', hm: '—', recruiter: 'Mara L. (Spencer Stuart)', rolesFor: ['CTO'] },
  { id: 6,  company: 'Datadog',      logo: 'D', role: 'VP Engineering, Platform',           loc: 'NYC',          comp: '$390–470k + eq', match: 82, fit: 'Stretch',   urgency: 'Cool', source: 'LinkedIn',  sourceDate: '4 days ago',    why: 'Platform modernization charter, observability', hm: '—', recruiter: '—', rolesFor: ['CTO','VPE'] },

  // AI / Transformation
  { id: 7,  company: 'Anthropic',    logo: 'A', role: 'VP AI Transformation',               loc: 'SF',           comp: '$380–460k + eq', match: 91, fit: 'Strategic', urgency: 'Hot',  source: 'Greenhouse',sourceDate: 'Today, 6:18am', why: 'AI transformation + your platform background', hm: 'L. Chen', recruiter: 'Direct apply', rolesFor: ['CTO','VPE','VPP'] },
  { id: 8,  company: 'Scale AI',     logo: 'S', role: 'VP AI Platform',                     loc: 'SF',           comp: '$360–440k + eq', match: 79, fit: 'Good',      urgency: 'Warm', source: 'LinkedIn',  sourceDate: '5 days ago',    why: 'Data ops + AI infra play', hm: '—', recruiter: '—', rolesFor: ['CTO','VPE'] },

  // Product-leaning
  { id: 9,  company: 'Stripe',       logo: 'S', role: 'VP Product Operations',              loc: 'NYC / Hybrid', comp: '$340–410k + eq', match: 88, fit: 'Good',      urgency: 'Warm', source: 'LinkedIn',  sourceDate: 'Today, 6:02am', why: 'Ops scale, payments adjacency, exec presence fit', hm: 'M. Cohen', recruiter: '—', rolesFor: ['VPP'] },
  { id: 10, company: 'Plaid',        logo: 'P', role: 'VP Product, Risk',                   loc: 'SF / Hybrid',  comp: '$330–400k + eq', match: 79, fit: 'Good',      urgency: 'Cool', source: 'Indeed',    sourceDate: 'Yesterday',     why: 'Risk + product ops overlap', hm: '—', recruiter: '—', rolesFor: ['VPP'] },
  { id: 11, company: 'Brex',         logo: 'B', role: 'VP Product, Platform',               loc: 'SF',           comp: '$320–390k + eq', match: 80, fit: 'Good',      urgency: 'Warm', source: 'LinkedIn',  sourceDate: '3 days ago',    why: 'SMB platform + risk product overlap', hm: '—', recruiter: '—', rolesFor: ['VPP'] },
  { id: 12, company: 'Notion',       logo: 'N', role: 'VP Product, AI',                     loc: 'SF / Remote',  comp: '$330–410k + eq', match: 83, fit: 'Good',      urgency: 'Warm', source: 'Recruiter', sourceDate: '4 days ago',    why: 'AI-first PM + collab product instincts', hm: '—', recruiter: 'Anna T. (Riviera)', rolesFor: ['VPP'] },
  { id: 13, company: 'Figma',        logo: 'F', role: 'Head of Product, Dev Platform',      loc: 'SF',           comp: '$310–380k + eq', match: 74, fit: 'Stretch',   urgency: 'Cool', source: 'LinkedIn',  sourceDate: '6 days ago',    why: 'Dev platform + design tooling', hm: '—', recruiter: '—', rolesFor: ['VPP','VPE'] },

  // VPE-leaning
  { id: 14, company: 'Linear',       logo: 'L', role: 'VP Engineering',                     loc: 'Remote',       comp: '$340–410k + eq', match: 85, fit: 'Good',      urgency: 'Warm', source: 'LinkedIn',  sourceDate: '2 days ago',    why: 'Tools-quality bar + dev productivity', hm: '—', recruiter: '—', rolesFor: ['VPE'] },
  { id: 15, company: 'Vercel',       logo: 'V', role: 'VP Engineering, Edge',               loc: 'SF / Remote',  comp: '$360–440k + eq', match: 87, fit: 'Good',      urgency: 'Warm', source: 'Recruiter', sourceDate: '3 days ago',    why: 'Edge platform + infra ops at scale', hm: '—', recruiter: 'James R. (Russell Reynolds)', rolesFor: ['VPE','CTO'] },
  { id: 16, company: 'GitHub',       logo: 'G', role: 'VP Engineering, Platform',           loc: 'Remote',       comp: '$390–480k + eq', match: 86, fit: 'Strategic', urgency: 'Warm', source: 'Recruiter', sourceDate: '5 days ago',    why: 'Developer platform · AI Copilot adjacency', hm: '—', recruiter: 'Tom P. (Heidrick)', rolesFor: ['VPE','CTO'] },
  { id: 17, company: 'Retool',       logo: 'R', role: 'VP Engineering',                     loc: 'SF',           comp: '$320–400k + eq', match: 78, fit: 'Good',      urgency: 'Cool', source: 'LinkedIn',  sourceDate: '1 week ago',    why: 'Internal-tools depth · platform engineering', hm: '—', recruiter: '—', rolesFor: ['VPE'] },

  // Cross-cutting / longshots
  { id: 18, company: 'Discord',      logo: 'D', role: 'VP Platform',                        loc: 'SF / Remote',  comp: '$340–420k + eq', match: 72, fit: 'Stretch',   urgency: 'Cool', source: 'LinkedIn',  sourceDate: '1 week ago',    why: 'Realtime infra · large user base', hm: '—', recruiter: '—', rolesFor: ['CTO','VPE'] },
  { id: 19, company: 'Reddit',       logo: 'R', role: 'VP Engineering, Ads Platform',       loc: 'NYC',          comp: '$370–450k + eq', match: 70, fit: 'Stretch',   urgency: 'Cool', source: 'LinkedIn',  sourceDate: '1 week ago',    why: 'Ads infra · ML serving', hm: '—', recruiter: '—', rolesFor: ['VPE','CTO'] },
  { id: 20, company: 'OpenAI',       logo: 'O', role: 'Head of Product, Platform',          loc: 'SF',           comp: '$380–460k + eq', match: 89, fit: 'Strategic', urgency: 'Hot',  source: 'Recruiter', sourceDate: '2 days ago',    why: 'Platform PM at AI frontier', hm: 'K. Singh', recruiter: 'Direct intro', rolesFor: ['VPP','CTO'] },
  { id: 21, company: 'Databricks',   logo: 'D', role: 'VP Engineering, AI Platform',        loc: 'SF',           comp: '$400–490k + eq', match: 85, fit: 'Strategic', urgency: 'Warm', source: 'LinkedIn',  sourceDate: '4 days ago',    why: 'Data + AI platform · enterprise scale', hm: '—', recruiter: '—', rolesFor: ['VPE','CTO'] },
  { id: 22, company: 'Block',        logo: 'B', role: 'VP Product, Cash App Platform',      loc: 'SF / Remote',  comp: '$330–410k + eq', match: 76, fit: 'Good',      urgency: 'Cool', source: 'Indeed',    sourceDate: '1 week ago',    why: 'Consumer fintech platform', hm: '—', recruiter: '—', rolesFor: ['VPP'] },
  { id: 23, company: 'Robinhood',    logo: 'R', role: 'VP Engineering, Platform',           loc: 'NYC',          comp: '$360–440k + eq', match: 73, fit: 'Stretch',   urgency: 'Cool', source: 'LinkedIn',  sourceDate: '1 week ago',    why: 'Trading infra · platform at scale', hm: '—', recruiter: '—', rolesFor: ['VPE'] },
  { id: 24, company: 'Airtable',     logo: 'A', role: 'Head of Product, AI',                loc: 'SF',           comp: '$320–390k + eq', match: 75, fit: 'Good',      urgency: 'Cool', source: 'LinkedIn',  sourceDate: '1 week ago',    why: 'AI on top of low-code · platform thinking', hm: '—', recruiter: '—', rolesFor: ['VPP'] },
];

// Demo states pre-stage opportunities differently
// Returns a map of opp_id -> stage_id (only includes opps that are "active" in this state)
const DEMO_STATES = {
  fresh: {
    label: 'Just started',
    blurb: 'Day 3 · just connected inbox, building a pipeline',
    swipe_remaining: 12,
    stages: {
      1: 'discovered', 2: 'discovered', 7: 'saved', 9: 'discovered', 14: 'saved',
      15: 'discovered', 16: 'discovered', 20: 'saved', 8: 'discovered', 12: 'discovered',
      3: 'discovered', 21: 'discovered',
    },
    metrics: { active: 12, hot: 0, replyRate: '—', interviewRate: '—', avgDays: '—', assetOpens: 2 },
  },
  mid: {
    label: 'Mid-pipeline',
    blurb: 'Day 24 · cadence running, first replies arriving',
    swipe_remaining: 8,
    stages: {
      1: 'engaged', 2: 'screen', 3: 'outreach', 7: 'r1', 9: 'engaged',
      14: 'outreach', 15: 'panel', 16: 'engaged', 20: 'screen', 12: 'outreach',
      8: 'applied', 21: 'enriched', 4: 'saved', 6: 'saved', 11: 'applied',
      17: 'discovered', 18: 'discovered', 24: 'discovered',
    },
    metrics: { active: 18, hot: 3, replyRate: '24%', interviewRate: '11%', avgDays: '7.1', assetOpens: 31 },
  },
  closing: {
    label: 'Closing offer',
    blurb: 'Day 42 · final rounds + first offer in hand',
    swipe_remaining: 5,
    stages: {
      1: 'final', 2: 'screen', 7: 'panel', 9: 'r1', 14: 'r1',
      15: 'final', 16: 'panel', 20: 'offer', 21: 'engaged', 12: 'screen',
      8: 'outreach', 3: 'engaged', 17: 'applied', 6: 'applied', 5: 'outreach',
      4: 'saved', 11: 'discovered', 18: 'discovered', 22: 'discovered', 24: 'discovered',
      13: 'enriched', 19: 'discovered',
    },
    metrics: { active: 22, hot: 4, replyRate: '31%', interviewRate: '18%', avgDays: '6.2', assetOpens: 47 },
  },
};

// Stakeholders, signals & pain hypotheses for the deep command-center mock
const OPP_DETAILS = {
  1: { // Cloudflare
    stakeholders: [
      { n:'M. Prince',         r:'CEO · final approver',   sig:'Posts about platform reliability', match:'92' },
      { n:'M. Zatlyn',         r:'COO · cross-functional', sig:'Hired CFO 6w ago',                 match:'88' },
      { n:'J. Graham-Cumming', r:'CTO (outgoing)',         sig:'Transitioning to advisor',         match:'—'  },
      { n:'D. Henry',          r:'VP People · recruiter',  sig:'Reached out Mon · responded',      match:'95' },
    ],
    signals: [
      'Q1 earnings — beat on enterprise ARR, missed on margin',
      'Outage on Apr 18 — public postmortem cites infra debt',
      '3 senior infra hires in past 60d',
      'AI inference push announced at dev conf',
      'CEO interview: "platform reliability is #1 priority"',
    ],
    pain: [
      'Reliability vs. velocity tension under board pressure',
      'AI inference scaling without runaway cost',
      'Aging control plane vs new edge inference',
      'Need for an operating cadence the board can read',
    ],
  },
  7: { // Anthropic
    stakeholders: [
      { n:'D. Amodei',  r:'CEO',                       sig:'Public re: responsible scaling',   match:'90' },
      { n:'D. Krueger', r:'COO',                       sig:'Driving GTM operating model',      match:'82' },
      { n:'L. Chen',    r:'VP People · hiring sponsor',sig:'Initiated outreach Mon',           match:'93' },
      { n:'J. Clark',   r:'VP Policy · adjacent',      sig:'Posts on AI safety governance',    match:'70' },
    ],
    signals: [
      'Recent enterprise rollouts at scale',
      'Hiring 3 senior platform leaders in 60d',
      'Public commentary on responsible scaling',
      'AI safety + governance investment',
    ],
    pain: [
      'Operating an AI org the board can read',
      'Going from frontier research → enterprise platform',
      'Bridging safety, product velocity & enterprise GTM',
    ],
  },
};

const PLAYBOOKS_X = [
  { id: 1,  name: '30 / 60 / 90 Day Plan',          tag: 'Onboarding',  pages: 12, uses: 6 },
  { id: 2,  name: 'First-Year Executive Roadmap',   tag: 'Onboarding',  pages: 18, uses: 3 },
  { id: 3,  name: 'Annual Operating Cycle',         tag: 'Operating',   pages: 14, uses: 4 },
  { id: 4,  name: 'AI Governance Playbook',         tag: 'AI / Risk',   pages: 22, uses: 5 },
  { id: 5,  name: 'Product Operating Model',        tag: 'Operating',   pages: 16, uses: 2 },
  { id: 6,  name: 'Engineering Modernization',      tag: 'Tech',        pages: 24, uses: 4 },
  { id: 7,  name: 'Stakeholder Alignment',          tag: 'Influence',   pages: 9,  uses: 7 },
  { id: 8,  name: 'Transformation Roadmap',         tag: 'Strategy',    pages: 20, uses: 3 },
  { id: 9,  name: 'Cost Optimization',              tag: 'Finance',     pages: 11, uses: 2 },
  { id: 10, name: 'Talent Assessment',              tag: 'People',      pages: 10, uses: 3 },
  { id: 11, name: 'Executive Communication Plan',   tag: 'Influence',   pages: 8,  uses: 4 },
  { id: 12, name: 'Risk + Compliance Operating',    tag: 'Risk',        pages: 13, uses: 1 },
];

const ASSETS_X = [
  { name: 'CTO Resume — Infra v3.2',          type: 'Resume',    opens: 14, views: 0,  dur: '—',    forwards: 3, lastView: 'Today' },
  { name: 'AI Transformation Portfolio Deck', type: 'Deck',      opens: 22, views: 86, dur: '4:12', forwards: 5, lastView: 'Today' },
  { name: '30/60/90 — Cloudflare tailored',   type: 'Plan',      opens: 4,  views: 12, dur: '6:48', forwards: 1, lastView: 'Yesterday' },
  { name: 'Exec intro video — 60s',           type: 'Video',     opens: 9,  views: 9,  dur: '0:54', forwards: 2, lastView: '2d ago' },
  { name: 'AI Governance Playbook v1',        type: 'Playbook',  opens: 6,  views: 6,  dur: '8:21', forwards: 0, lastView: '3d ago' },
  { name: 'CTO operating cycle — annual',     type: 'Plan',      opens: 2,  views: 4,  dur: '3:02', forwards: 0, lastView: '4d ago' },
  { name: 'Modernization case study',         type: 'Deck',      opens: 11, views: 27, dur: '5:18', forwards: 1, lastView: '1d ago' },
  { name: 'Platform cost POV — 1pg',          type: 'Plan',      opens: 8,  views: 16, dur: '2:22', forwards: 2, lastView: 'Today' },
];

const TEMPLATES_X = [
  { cat: 'Resume',             items: ['CTO — Infra Modernization', 'CTO — AI / Platform', 'VP Eng — Platform', 'VP Product — Ops'] },
  { cat: 'Cover letter',       items: ['Executive — high-fit', 'Stretch role — narrative', 'Referral introduction'] },
  { cat: 'Recruiter outreach', items: ['Initial — warm intro', 'Initial — cold', 'Follow-up #1', 'Follow-up #2', 'Re-engage stale lead'] },
  { cat: 'Hiring mgr outreach',items: ['Direct intro', 'Mutual-connection intro', 'Value-add point-of-view'] },
  { cat: 'LinkedIn',           items: ['Connection request', 'Post-intro DM', 'Re-share + comment hook'] },
  { cat: 'Thank-you',          items: ['Screening', 'Panel', 'Final round', 'Decline w/ door open'] },
  { cat: 'Portfolio decks',    items: ['CTO master deck', 'AI Transformation deck', 'Modernization case study'] },
  { cat: 'Intro video',        items: ['60s exec intro', '2-min role pitch'] },
];

const INTERVIEW_Q = [
  { q: 'Walk us through your last modernization charter — outcomes vs. plan?',         strength: 'strong'  },
  { q: 'How would you frame an AI governance operating model for our board?',          strength: 'weak'    },
  { q: 'What is your 30/60/90 here in the first quarter?',                              strength: 'strong'  },
  { q: 'Tell me about a stakeholder you lost and how you rebuilt the relationship.',   strength: 'medium'  },
  { q: 'How do you set the platform vs. product investment ratio?',                    strength: 'medium'  },
  { q: 'Where would you be willing to cut to fund modernization?',                     strength: 'rough'   },
  { q: 'How would you onboard with the existing leadership team?',                     strength: 'strong'  },
];

const NOTIF = [
  { type: 'follow',  text: 'Follow up with Sarah K. (Heidrick) — Snowflake',  when: 'Today' },
  { type: 'open',    text: 'Cloudflare CTO opened your portfolio deck 2×',    when: '24m ago' },
  { type: 'prep',    text: 'Anthropic panel prep ready to review',            when: 'Today' },
  { type: 'debrief', text: 'Ramp screening debrief still missing',            when: '1d overdue' },
  { type: 'stale',   text: 'Plaid — no response in 3d, suggest re-engage',    when: '' },
  { type: 'new',     text: '12 new opportunities found overnight',            when: 'Today' },
];

// Keyword banks for JD analysis / ATS optimization, per persona baseline.
const KEYWORDS = {
  CTO: [
    { kw:'platform modernization', must:true },
    { kw:'AI/ML infrastructure',   must:true },
    { kw:'cost optimization',      must:true },
    { kw:'multi-region / edge',    must:false },
    { kw:'P&L ownership',          must:true },
    { kw:'board reporting',        must:false },
    { kw:'SRE / reliability (SLO)',must:true },
    { kw:'org scaling 100+',       must:false },
    { kw:'zero-downtime migration',must:false },
    { kw:'cloud (AWS/GCP)',        must:true },
    { kw:'security & compliance',  must:false },
    { kw:'developer productivity', must:false },
  ],
  VPE: [
    { kw:'developer productivity', must:true },
    { kw:'platform engineering',   must:true },
    { kw:'org scaling',            must:true },
    { kw:'CI/CD & tooling',        must:true },
    { kw:'incident / on-call',     must:false },
    { kw:'hiring & mentorship',    must:true },
    { kw:'roadmap ownership',      must:false },
    { kw:'observability',          must:false },
    { kw:'microservices',          must:false },
    { kw:'agile at scale',         must:false },
    { kw:'cross-functional',       must:true },
    { kw:'cloud native',           must:false },
  ],
  VPP: [
    { kw:'product operations',     must:true },
    { kw:'risk / fraud product',   must:true },
    { kw:'multi-sided platform',   must:true },
    { kw:'roadmap & prioritization',must:true },
    { kw:'experimentation / A/B',  must:false },
    { kw:'0\u21921 and scaling',        must:false },
    { kw:'stakeholder alignment',  must:true },
    { kw:'metrics / North Star',   must:true },
    { kw:'GTM partnership',        must:false },
    { kw:'user research',          must:false },
    { kw:'AI product',             must:false },
    { kw:'pricing & packaging',    must:false },
  ],
};

// Application form question bank for the answers module
const APP_QUESTIONS = [
  { q:'Why are you interested in this role?',            limit: 900, cat:'Motivation' },
  { q:'Describe your most relevant leadership experience.',limit: 1200, cat:'Experience' },
  { q:'What is your approach to platform modernization?', limit: 1000, cat:'Technical' },
  { q:'Are you legally authorized to work in the US?',   limit: 120, cat:'Logistics', short:true },
  { q:'Do you require visa sponsorship now or in future?',limit: 120, cat:'Logistics', short:true },
  { q:'Desired base salary range?',                      limit: 120, cat:'Logistics', short:true },
  { q:'Earliest start date / notice period?',            limit: 120, cat:'Logistics', short:true },
  { q:'Are you open to relocation or hybrid?',           limit: 200, cat:'Logistics', short:true },
  { q:'How did you hear about us?',                      limit: 200, cat:'Logistics', short:true },
];

Object.assign(window, {
  PROTO, PROTO_DARK, STAGES, PERSONAS, ALL_OPPS, DEMO_STATES, OPP_DETAILS,
  PLAYBOOKS_X, ASSETS_X, TEMPLATES_X, INTERVIEW_Q, NOTIF, KEYWORDS, APP_QUESTIONS,
});
