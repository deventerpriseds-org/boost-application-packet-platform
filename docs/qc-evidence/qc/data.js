// Data for the packet QC prototype.
//
// Vocabulary and field rules come from the real prompts in
// docs/zap-289877647/prompts/ — not invented. The prompt's own section names are
// used as the UI's names: Missing ATS Skills · Swap Suggestions · Word &
// Character Check · ATS Distribution · Resume Summary Validation.
//
// Field contracts, verbatim from prompt 16:
//   Resume summary        55–60 words (hard)
//   Expertise             6 phrases, exactly 5 words each
//   Skills 1 / 2          ≤ 24 chars per item (QA prompt rule 3)
//   Relevant 1 / 2 / 3    9 total, max 1 item over 20 chars per list
//   Cover letter          250–400 words (strict, one page)
//   About Me 1            45–48 words, past tense
//   About Me 2            75–80 words, begins "My career"
//   Executive profile     50–55 words
//   Core accomplishments  exactly 5 bullets, 98–125 words
//   ATS keyword           < 30 chars
// Skills logic, verbatim: cross-check the JD, confirm 100% coverage of the
// verbatim ATS keywords, and swap the least relevant items to cover any that are
// missing. The UI reports what the prompt did; it does not second-guess it.

const PACKET = { id: 'pk_1', company: 'SafetyIQ', role: 'Head of Engineering', status: 'review', round: 2, passes: 3 };

const TERM_LIB = { id: 'ENG-LEAD v4', size: 1840, sources: ['O*NET 29.2', 'Lightcast skills', '3.1k exec postings', 'ATS field dictionaries'], updated: 'Jul 30' };

const POSTING = [
  { t: 'About the role', h: true },
  { t: 'SafetyIQ builds the safety-critical platform used by 400+ industrial operators. We are hiring a Head of Engineering to own the platform through its next phase of scale.' },
  { t: 'What you will do', h: true },
  { t: 'Lead modernization of our core safety platform across three business units', r: 'D1' },
  { t: 'Run the quarterly roadmap jointly with Product and commit to delivery dates', r: 'D2' },
  { t: 'Report to the CTO and present platform strategy to the board quarterly', r: 'D3' },
  { t: 'Own the engineering P&L, roughly $18M annually', r: 'D4' },
  { t: 'Requirements', h: true },
  { t: '10+ years engineering leadership, including a distributed organization of 60+', r: 'M1' },
  { t: 'Demonstrated ownership of SOC 2 Type II and ISO 27001 compliance', r: 'M2' },
  { t: 'Experience modernizing a monolithic platform to cloud-native services', r: 'M3' },
  { t: 'Track record of reducing delivery cycle time in a regulated environment', r: 'M4' },
  { t: 'P&L or budget ownership at $10M or above', r: 'M5' },
  { t: 'Nice to have', h: true },
  { t: 'Hands-on depth with Kubernetes and multi-region AWS', r: 'N1' },
  { t: 'Experience with FedRAMP or public-sector procurement', r: 'N2' },
  { t: 'Industrial, IoT or safety-critical domain background', r: 'N3' },
];

const REQUIREMENTS = [
  { id: 'M1', kind: 'must_have', competency: 'Distributed org, 60+', verbatim: '10+ years engineering leadership, including a distributed organization of 60+', coverage: 'covered', pass: 2, terms: ['T4'],
    evidence: { quote: 'Led globally distributed engineering organization delivering connected-product platforms.', source: 'Work history · VP Engineering, Resideo 2021–2025', extra: 'Profile headcount field: 62 engineers across three time zones.' } },
  { id: 'M2', kind: 'must_have', competency: 'SOC 2 / ISO 27001', verbatim: 'Demonstrated ownership of SOC 2 Type II and ISO 27001 compliance', coverage: 'covered', pass: 1, terms: ['T2', 'T3'],
    evidence: { quote: 'Established a security-first engineering culture, embedding DevSecOps practices within SDLC workflows, reducing compliance risks by 40%, and strengthening policies for regulatory alignment.', source: 'Accomplishment 3 · stored library', extra: 'Certifications: CISM. Skill bank lists SOC 2 Type II and ISO 27001.' } },
  { id: 'M3', kind: 'must_have', competency: 'Platform modernization', verbatim: 'Experience modernizing a monolithic platform to cloud-native services', coverage: 'covered', pass: 1, terms: ['T1', 'T12'],
    evidence: { quote: 'Executed a cloud migration strategy for an acquired business, transitioning 70% of infrastructure to AWS, improving security and compliance at 99.99% uptime, while reducing infrastructure spend by 30%.', source: 'Accomplishment 2 · stored library', extra: 'Also: “Modernized legacy enterprise platform toward service-based architecture” — Honeywell, 2017–2021.' } },
  { id: 'M4', kind: 'must_have', competency: 'Cycle time, regulated', verbatim: 'Track record of reducing delivery cycle time in a regulated environment', coverage: 'covered', pass: 3, terms: ['T11'],
    evidence: { quote: 'Led an enterprise-wide Agile transformation, ensuring requirements alignment and architecture compliance from kickoff to deployment, reducing time-to-market by 40%.', source: 'Accomplishment 4 · stored library', extra: 'One programme only — graded moderate, not a record across roles.' } },
  { id: 'M5', kind: 'must_have', competency: 'P&L ≥ $10M', verbatim: 'P&L or budget ownership at $10M or above', coverage: 'covered', pass: 2, terms: ['T5'],
    evidence: { quote: 'Partnered with CTO and CPO on multi-year technology roadmap and annual budget planning.', source: 'Work history · VP Engineering, Resideo', extra: 'Profile budget field: $18M engineering P&L held to plan. Skill bank: P&L Management.' } },
  { id: 'D1', kind: 'responsibility', competency: 'Multi-unit modernization', verbatim: 'Lead modernization of our core safety platform across three business units', coverage: 'covered', pass: 1, terms: ['T1'],
    evidence: { quote: 'Led a multi-year digital transformation, enhancing platform interoperability, customer-centric product roadmaps, and SaaS scalability, reducing $3M in costs and accelerating cross-unit collaboration.', source: 'Accomplishment 1 · stored library' } },
  { id: 'D2', kind: 'responsibility', competency: 'Roadmap with Product', verbatim: 'Run the quarterly roadmap jointly with Product and commit to delivery dates', coverage: 'covered', pass: 1, terms: ['T6'],
    evidence: { quote: 'Collaborated with the CTO and CPO on a 3-year technology roadmap, aligning engineering investment with growth and securing a $13M budget increase.', source: 'Accomplishment 5 · stored library' } },
  { id: 'D3', kind: 'responsibility', competency: 'Board reporting', verbatim: 'Report to the CTO and present platform strategy to the board quarterly', coverage: 'covered', pass: 1, terms: ['T7'],
    evidence: { quote: 'Designed and implemented OKRs and monthly executive ops reviews, increasing engineering efficiency and aligning execution with business goals.', source: 'Accomplishment 6 · stored library', extra: 'Reported to CTO at Resideo per work history.' } },
  { id: 'D4', kind: 'responsibility', competency: 'Engineering P&L $18M', verbatim: 'Own the engineering P&L, roughly $18M annually', coverage: 'covered', pass: 2, terms: ['T5'],
    evidence: { quote: 'Partnered with CTO and CPO on multi-year technology roadmap and annual budget planning.', source: 'Work history · Resideo', extra: 'Profile budget field: $18M engineering P&L.' } },
  { id: 'N1', kind: 'nice_to_have', competency: 'Kubernetes, multi-region AWS', verbatim: 'Hands-on depth with Kubernetes and multi-region AWS', coverage: 'covered', pass: 1, terms: ['T8', 'T9'],
    evidence: { quote: 'transitioning 70% of infrastructure to AWS … at 99.99% uptime', source: 'Accomplishment 2 · stored library', extra: 'Skill bank: Kubernetes, Amazon Web Services (AWS), Cloud Infrastructure. Certification: AWS Solutions Architect.' } },
  { id: 'N3', kind: 'nice_to_have', competency: 'Safety-critical domain', verbatim: 'Industrial, IoT or safety-critical domain background', coverage: 'covered', pass: 3, terms: ['T13'],
    evidence: { quote: 'Built out delivery organization supporting industrial software portfolio.', source: 'Work history · GE Digital 2013–2017', extra: 'Connected-product platforms at Resideo. Adjacent, not certification work — graded moderate.' } },
  { id: 'N2', kind: 'nice_to_have', competency: 'FedRAMP / public sector', verbatim: 'Experience with FedRAMP or public-sector procurement', coverage: 'open', pass: null, terms: ['T10'],
    evidence: null },
];

// status: covered (already in the profile) · inserted (placed by a swap) · open
// match: exact  = the literal library term is in the text
//        variant = same concept, different wording (accepted by default, shown)
//        loose   = adjacent concept, weaker credit, flagged for a look
// Variants are what keeps the assets from mirroring the posting word for word.
const ATS_TERMS = [
  { id: 'T1', term: 'Platform Modernization', reqs: ['M3', 'D1'], source: 'library', freq: 3, status: 'covered', pass: 1, match: 'exact', used: 'Platform Modernization', postingSays: 'Lead modernization of our core safety platform', note: 'Standard industry term, safe to state literally.' },
  { id: 'T2', term: 'SOC 2 Type II', reqs: ['M2'], source: 'library', freq: 2, status: 'covered', pass: 1, match: 'exact', used: 'SOC 2 Type II', postingSays: 'ownership of SOC 2 Type II', note: 'A named standard has one correct spelling. Never paraphrase.' },
  { id: 'T3', term: 'ISO 27001', reqs: ['M2'], source: 'library', freq: 1, status: 'inserted', pass: 1, match: 'exact', used: 'ISO 27001', postingSays: 'and ISO 27001 compliance', note: 'Named standard.' },
  { id: 'T4', term: 'Distributed Teams', reqs: ['M1'], source: 'library', freq: 2, status: 'inserted', pass: 2, match: 'variant', used: 'Distributed Teams', postingSays: 'a distributed organization of 60+', note: 'Concept term, no headcount echoed. The figure itself sits in the summary, not in a skills chip.' },
  { id: 'T5', term: 'P&L Ownership', reqs: ['M5', 'D4'], source: 'library', freq: 2, status: 'inserted', pass: 2, match: 'variant', used: 'P&L Ownership', postingSays: 'P&L or budget ownership at $10M or above', note: 'Your profile says P&L Optimization. Ownership is the posting\'s own framing and both are the same competency, so this reads as a rewording rather than a copy.' },
  { id: 'T6', term: 'Roadmap Alignment', reqs: ['D2'], source: 'library', freq: 2, status: 'inserted', pass: 1, match: 'variant', used: 'Roadmap Alignment', postingSays: 'Run the quarterly roadmap jointly with Product', note: 'Library phrasing, not the posting\'s sentence.' },
  { id: 'T7', term: 'Board Reporting', reqs: ['D3'], source: 'library', freq: 1, status: 'covered', pass: 1, match: 'variant', used: 'Board Reporting', postingSays: 'present platform strategy to the board quarterly', note: 'Compressed to the competency.' },
  { id: 'T8', term: 'Kubernetes', reqs: ['N1'], source: 'library', freq: 1, status: 'covered', pass: 1, match: 'exact', used: 'Kubernetes', postingSays: 'Hands-on depth with Kubernetes', note: 'Product name.' },
  { id: 'T9', term: 'Multi-region AWS', reqs: ['N1'], source: 'library', freq: 1, status: 'covered', pass: 1, match: 'exact', used: 'Multi-region AWS', postingSays: 'multi-region AWS', note: 'Product name.' },
  { id: 'T11', term: 'Cycle Time Reduction', reqs: ['M4'], source: 'library', freq: 1, status: 'inserted', pass: 3, match: 'variant', used: 'Cycle Time Reduction', postingSays: 'reducing delivery cycle time in a regulated environment', note: 'Noun form of the posting\'s verb phrase.' },
  { id: 'T12', term: 'Cloud-native Services', reqs: ['M3'], source: 'library', freq: 2, status: 'covered', pass: 1, match: 'exact', used: 'Cloud-native Services', postingSays: 'to cloud-native services', note: 'Common architecture term.' },
  { id: 'T13', term: 'Safety-critical Systems', reqs: ['N3'], source: 'library', freq: 2, status: 'inserted', pass: 3, match: 'variant', used: 'Safety-critical Systems', postingSays: 'Industrial, IoT or safety-critical domain background', note: 'Domain term, not the posting\'s full clause.' },
  { id: 'T10', term: 'FedRAMP', reqs: ['N2'], source: 'library', freq: 1, status: 'open', pass: null, match: null, used: null, postingSays: 'Experience with FedRAMP or public-sector procurement', note: 'No evidence in your profile.' },
  { id: 'T14', term: 'DevSecOps', reqs: ['M2'], source: 'model', freq: 0, status: 'covered', pass: 1, match: 'loose', used: 'DevSecOps', postingSays: '— not in the posting', note: 'Model suggestion with no library entry and no posting mention. Passes, but earns no score credit — worth a look before approval.' },
  { id: 'T15', term: 'Regulated Environments', reqs: ['M4'], source: 'model', freq: 0, status: 'covered', pass: 3, match: 'loose', used: 'regulated delivery', postingSays: 'in a regulated environment', note: 'Adjacent wording. Not scored.' },
];

const PASSES = [
  { n: 1, at: '09:02', closed: ['M2', 'M3', 'D1', 'D2', 'D3', 'N1'], open: ['M1', 'M4', 'M5', 'D4', 'N2', 'N3'], note: 'Profile already covered six lines. Summary and both skills lists written.' },
  { n: 2, at: '09:07', closed: ['M1', 'M5', 'D4'], open: ['M4', 'N2', 'N3'], note: 'Least relevant skills swapped for the two uncovered keywords; 60+ and $18M surfaced from work history.' },
  { n: 3, at: '09:11', closed: ['M4', 'N3'], open: ['N2'], note: 'Cycle time tied to the regulated context. Safety-critical named.' },
  { n: 4, at: '09:14', closed: [], open: ['N2'], halt: true, note: 'No profile evidence for FedRAMP. Stopped rather than write it.' },
];

// action: kept | swapped | added. Reason is always the prompt's own logic:
// swap the least relevant item to cover an uncovered ATS keyword.
const SKILL_ROWS = [
  { list: 'Skills 1', orig: 'Enterprise Governance', final: 'Enterprise Governance', action: 'kept', req: 'M2', term: 'T2', quote: 'Demonstrated ownership of SOC 2 Type II and ISO 27001 compliance', why: 'Already covers this requirement.' },
  { list: 'Skills 1', orig: 'Technology Strategy', final: 'Technology Strategy', action: 'kept', req: 'D3', term: 'T7', quote: 'present platform strategy to the board quarterly', why: 'Already covers this responsibility.' },
  { list: 'Skills 1', orig: 'Agile Transformation', final: 'Platform Modernization', action: 'swapped', req: 'M3', term: 'T1', quote: 'Experience modernizing a monolithic platform to cloud-native services', why: 'Keyword appears 3× in the posting and was uncovered.' },
  { list: 'Skills 1', orig: 'Digital Transformation', final: 'Cloud-native Services', action: 'swapped', req: 'M3', term: 'T12', quote: 'modernizing a monolithic platform to cloud-native services', why: 'Verbatim posting phrase.' },
  { list: 'Skills 1', orig: 'Risk Management', final: 'Risk Management', action: 'kept', req: 'M2', term: 'T2', quote: 'Demonstrated ownership of SOC 2 Type II and ISO 27001 compliance', why: 'Covers compliance framing.' },
  { list: 'Skills 1', orig: 'Business Alignment', final: 'Roadmap Alignment', action: 'swapped', req: 'D2', term: 'T6', quote: 'Run the quarterly roadmap jointly with Product and commit to delivery dates', why: 'Posting names roadmap co-ownership.' },
  { list: 'Skills 1', orig: 'Cybersecurity Compliance', final: 'SOC 2 / ISO 27001', action: 'swapped', req: 'M2', term: 'T2', quote: 'Demonstrated ownership of SOC 2 Type II and ISO 27001 compliance', why: 'An ATS screens on the named standard, not the category above it. The posting spells out both, so the list spells out both.' },
  { list: 'Skills 1', orig: 'Cloud Architecture', final: 'Multi-region AWS', action: 'swapped', req: 'N1', term: 'T9', quote: 'Hands-on depth with Kubernetes and multi-region AWS', why: 'Verbatim posting phrase, 16 chars.' },
  { list: 'Skills 2', orig: 'Strategic Roadmaps', final: 'Strategic Roadmaps', action: 'kept', req: 'D2', term: 'T6', quote: 'Run the quarterly roadmap jointly with Product', why: 'Already covers this responsibility.' },
  { list: 'Skills 2', orig: 'Stakeholder Engagement', final: 'Stakeholder Engagement', action: 'kept', req: 'D3', term: 'T7', quote: 'Report to the CTO and present platform strategy to the board', why: 'Covers board and CTO reporting.' },
  { list: 'Skills 2', orig: 'Revenue Optimization', final: 'P&L Ownership', action: 'swapped', req: 'M5', term: 'T5', quote: 'P&L or budget ownership at $10M or above', why: 'A hard requirement was still uncovered after pass 1. Revenue Optimization was the least relevant item in this list against this posting, and your profile already carries the P&L experience — so the list now names it.' },
  { list: 'Skills 2', orig: 'SaaS Leadership', final: 'Distributed Teams', action: 'swapped', req: 'M1', term: 'T4', quote: '10+ years engineering leadership, including a distributed organization of 60+', why: 'Org scale is a must-have and SaaS appears nowhere in this posting, which made this the cheapest slot to give up.' },
  { list: 'Skills 2', orig: 'Process Improvement', final: 'Cycle Time Reduction', action: 'swapped', req: 'M4', term: 'T11', quote: 'Track record of reducing delivery cycle time in a regulated environment', why: 'Closed the last open keyword at pass 3.' },
  { list: 'Skills 2', orig: 'Regulatory Compliance', final: 'Regulatory Compliance', action: 'kept', req: 'M4', term: 'T15', quote: 'reducing delivery cycle time in a regulated environment', why: 'Already covers the regulated framing.' },
  { list: 'Skills 2', orig: 'Platform Engineering', final: 'Safety-critical Systems', action: 'swapped', req: 'N3', term: 'T13', quote: 'Industrial, IoT or safety-critical domain background', why: 'Domain keyword the posting asks for.' },
  { list: 'Skills 2', orig: 'M&A Due Diligence', final: 'Kubernetes', action: 'swapped', req: 'N1', term: 'T8', quote: 'Hands-on depth with Kubernetes and multi-region AWS', why: 'Your omission list rules out M&A and tech due diligence, so this slot was already going to change. It took Kubernetes because that keyword was still uncovered and the posting names it outright.' },
  { list: 'Relevant 1', orig: 'Standards & Compliance', final: 'SOC 2 Type II', action: 'swapped', req: 'M2', term: 'T2', quote: 'Demonstrated ownership of SOC 2 Type II', why: 'Named standard, 13 chars.' },
  { list: 'Relevant 1', orig: 'AI/ML Strategy', final: 'DevSecOps', action: 'swapped', req: 'M2', term: 'T14', quote: 'Demonstrated ownership of SOC 2 Type II and ISO 27001 compliance', why: 'Weakest link in this set. DevSecOps is a model suggestion, not a library keyword — the posting implies secure delivery practice without ever using the word, so it earns no score credit. Worth a look before you approve.' },
  { list: 'Relevant 1', orig: 'Data Strategy', final: 'Board Reporting', action: 'swapped', req: 'D3', term: 'T7', quote: 'present platform strategy to the board quarterly', why: 'Explicit responsibility.' },
  { list: 'Relevant 1', orig: 'Customer-Centricity', final: 'Customer-Centricity', action: 'kept', req: null, term: null, quote: null, why: 'Kept — within the 20-char rule and no keyword needed this slot.' },
  { list: 'Relevant 2', orig: 'Digital Platform Maturity', final: 'Cloud Migration', action: 'swapped', req: 'M3', term: 'T12', quote: 'modernizing a monolithic platform to cloud-native services', why: 'The original runs 25 characters against the 20-char rule, so it had to shorten regardless. Cloud Migration fits at 15 and is evidenced by the AWS programme in your work history.' },
  { list: 'Relevant 2', orig: 'SaaS Growth Strategy', final: 'Org Scaling 60+', action: 'swapped', req: 'M1', term: 'T4', quote: 'a distributed organization of 60+', why: 'Carries the headcount the requirement names.' },
  { list: 'Relevant 2', orig: 'Tech-Driven Innovation', final: 'Safety-critical', action: 'swapped', req: 'N3', term: 'T13', quote: 'Industrial, IoT or safety-critical domain background', why: 'Closed N3 at pass 3.' },
  { list: 'Relevant 2', orig: 'Corporate AI Use Cases', final: 'Corporate AI Use Cases', action: 'kept', req: null, term: null, quote: null, why: 'Kept.' },
  { list: 'Relevant 3', orig: 'P&L Optimization', final: 'P&L $18M', action: 'swapped', req: 'D4', term: 'T5', quote: 'Own the engineering P&L, roughly $18M annually', why: 'Matches the figure in the posting.' },
  { list: 'Relevant 3', orig: 'Budget & Cost Control', final: 'Cost Optimization', action: 'swapped', req: 'M5', term: 'T5', quote: 'P&L or budget ownership at $10M or above', why: '21 chars over the rule; shortened to 17.' },
  { list: 'Relevant 3', orig: 'Investment Strategy', final: 'Delivery Commitments', action: 'swapped', req: 'D2', term: 'T6', quote: 'commit to delivery dates', why: 'The posting is unusually specific about committing to dates and never raises investment strategy, so the slot moved to the thing being asked for.' },
];

const L = (list) => SKILL_ROWS.filter(r => r.list === list).map(r => ({ orig: r.orig, final: r.final, req: r.req, term: r.term, action: r.action, why: r.why, quote: r.quote }));

// Soft/hard skill bank from the profile — not wired to any merge field, but
// available for manual swaps.
const SKILL_BANK = [
  'Acquisitions', 'Amazon Redshift', 'Amazon S3', 'Amazon Web Services (AWS)', 'Architecture', 'Artificial Intelligence (AI)',
  'Big Data', 'Budget Management', 'Business Acumen', 'Business Intelligence', 'Business Strategy', 'Change Management',
  'Cloud Computing', 'Cloud Infrastructure', 'Cybersecurity', 'Data Analytics', 'Data Engineering', 'Data Governance',
  'Data Privacy', 'Data Quality', 'Data Science', 'DataBricks', 'DevOps', 'Digital Strategy', 'Emerging Technologies',
  'Engineering Management', 'Enterprise Software', 'Executive Management', 'ETL', 'GDPR', 'Google Cloud Platform (GCP)',
  'High Performance Teams', 'Information Security', 'Infrastructure Management', 'IT Portfolio', 'IT Risk Management',
  'IT Strategy', 'ITIL', 'Key Performance Indicators', 'Leadership', 'Machine Learning', 'Master Data Management',
  'Mentoring', 'Microsoft Azure', 'Microsoft Power BI', 'Negotiation', 'Network Security', 'Optimizing Performance',
  'P&L Management', 'PCI', 'People Management', 'Performance Measurement', 'Platform Architecture', 'Kubernetes',
  'Multi-region AWS', 'SOC 2 Type II', 'ISO 27001', 'FedRAMP',
];

const w = (s) => s.trim().split(/\s+/).length;

const ASSET_DOCS = {
  resume: {
    label: 'Resume', kind: 'doc', target: 'Google Doc · 7 merge fields',
    sections: [
      { id: 'R1', field: 'ResumeSummary', slot: 'Resume summary', type: 'text', dynamic: true, edited: true, pass: 3,
        rule: '55–60 words', reqs: ['M3', 'D1', 'M1', 'M5', 'M4'], terms: ['T1', 'T12', 'T4', 'T5', 'T11'],
        before: 'Visionary executive leader with a track record of aligning top-level goals to technology strategy and execution to drive continuous value creation, operational efficiency, and enterprise transformations. Adept at leading high-impact initiatives, optimizing digital ecosystems, and strengthening governance frameworks.',
        after: 'Engineering executive built for platform modernization: monoliths into cloud-native services, distributed teams past sixty engineers, and P&L ownership at eighteen million. I bring governance that holds under audit, cycle time reduction inside regulated delivery, and the habit of turning technology investment into operational efficiency, enterprise transformation, and revenue growth a board can see quarter after quarter.',
        why: 'Declares who I am and what I bring, not examples, per the prompt.' },
      { id: 'R2', field: 'SkillsBullets1', slot: 'Skills 1', type: 'list', dynamic: true, edited: true, pass: 1,
        rule: '≤ 24 chars each', reqs: ['M2', 'M3', 'N1', 'D2', 'D3'], terms: ['T1', 'T12', 'T2', 'T6', 'T9'], items: L('Skills 1') },
      { id: 'R3', field: 'SkillsBullets2', slot: 'Skills 2', type: 'list', dynamic: true, edited: true, pass: 2,
        rule: '≤ 24 chars each', reqs: ['M1', 'M4', 'M5', 'N1', 'N3', 'D2'], terms: ['T4', 'T5', 'T11', 'T13', 'T8'], items: L('Skills 2') },
      { id: 'R4', field: 'ExpertiseBullets', slot: 'Expertise', type: 'list', dynamic: true, edited: true, pass: 1,
        rule: '6 phrases, exactly 5 words', reqs: ['M5', 'M2', 'D2'], terms: ['T5'],
        items: [
          { orig: 'Budget Development and P&L Management', final: 'Budget development and P&L ownership', action: 'swapped', req: 'M5', term: 'T5', why: '5 words, carries the P&L keyword.' },
          { orig: 'KPI-driven performance management', final: 'KPI driven engineering performance management', action: 'swapped', req: null, why: 'Padded to the 5-word rule.' },
          { orig: 'Enterprise alignment of strategy and execution', final: 'Enterprise strategy and execution alignment', action: 'swapped', req: 'D2', why: '6 words to 5.' },
          { orig: 'Governance frameworks for compliance', final: 'Governance frameworks for audit compliance', action: 'swapped', req: 'M2', term: 'T2', why: 'Audit language matches the requirement.' },
          { orig: 'Optimizing scaled agile operations', final: 'Optimizing scaled software delivery operations', action: 'swapped', req: 'M4', why: 'Delivery framing over agile framing.' },
          { orig: 'Strategic roadmaps for customer-centric innovation', final: 'Strategic roadmaps with product partnership', action: 'swapped', req: 'D2', term: 'T6', why: 'Posting names the Product partnership.' },
        ] },
      { id: 'R5', field: 'RelevantBullets1', slot: 'Relevant 1', type: 'list', dynamic: true, edited: true, pass: 1,
        rule: 'max 1 item over 20 chars', reqs: ['M2', 'D3'], terms: ['T2', 'T7'], items: L('Relevant 1') },
      { id: 'R6', field: 'RelevantBullets2', slot: 'Relevant 2', type: 'list', dynamic: true, edited: true, pass: 3,
        rule: 'max 1 item over 20 chars', reqs: ['M1', 'M3', 'N3'], terms: ['T13', 'T4', 'T12'], items: L('Relevant 2') },
      { id: 'R7', field: 'RelevantBullets3', slot: 'Relevant 3', type: 'list', dynamic: true, edited: true, pass: 2,
        rule: 'max 1 item over 20 chars', reqs: ['M5', 'D4', 'D2'], terms: ['T5', 'T6'], items: L('Relevant 3') },
      { id: 'R8', field: null, slot: 'Work experience', type: 'text', dynamic: false, reqs: [], terms: [], sameAsBefore: true,
        after: 'VP Engineering — Resideo · 2021–2025\n· Led globally distributed engineering organization delivering connected-product platforms.\n· Drove cloud migration of acquired business unit, improving security posture and uptime.\n· Partnered with CTO and CPO on multi-year technology roadmap and annual budget planning.\n\nSenior Director, Platform Engineering — Honeywell · 2017–2021\n· Modernized legacy enterprise platform toward service-based architecture.\n· Established governance and compliance practice across product lines.\n\nDirector of Engineering — GE Digital · 2013–2017\n· Built out delivery organization supporting industrial software portfolio.',
        before: 'VP Engineering — Resideo · 2021–2025\n· Led globally distributed engineering organization delivering connected-product platforms.\n· Drove cloud migration of acquired business unit, improving security posture and uptime.\n· Partnered with CTO and CPO on multi-year technology roadmap and annual budget planning.\n\nSenior Director, Platform Engineering — Honeywell · 2017–2021\n· Modernized legacy enterprise platform toward service-based architecture.\n· Established governance and compliance practice across product lines.\n\nDirector of Engineering — GE Digital · 2013–2017\n· Built out delivery organization supporting industrial software portfolio.',
        why: 'No merge field exists. The zap populates seven fields and none is work history, so these bullets read the same in every packet — including the two figures the posting asks for.' },
      { id: 'R9', field: null, slot: 'Header, education, certifications', type: 'text', dynamic: false, reqs: [], terms: [], sameAsBefore: true,
        after: 'VON ROBERTS\nAustin, TX · von@enterpriseds.io · linkedin.com/in/vonroberts\n\nEDUCATION\nMBA, Technology Management — University of Texas\nBS, Computer Science — Georgia Tech\n\nCERTIFICATIONS\nAWS Certified Solutions Architect · ITIL v4 Foundation · CISM',
        before: 'VON ROBERTS\nAustin, TX · von@enterpriseds.io · linkedin.com/in/vonroberts\n\nEDUCATION\nMBA, Technology Management — University of Texas\nBS, Computer Science — Georgia Tech\n\nCERTIFICATIONS\nAWS Certified Solutions Architect · ITIL v4 Foundation · CISM',
        why: 'No merge field. Same in every packet.' },
    ] },
  compact_resume: {
    label: 'ATS resume', kind: 'doc', target: 'Google Doc · 6 merge fields',
    sections: [
      { id: 'A1', field: 'ResumeSummary', slot: 'Resume summary', type: 'text', dynamic: true, edited: true, pass: 3, rule: '55–60 words',
        reqs: ['M3', 'M1', 'M5'], terms: ['T1', 'T4', 'T5'],
        before: 'Visionary executive leader aligning top-level goals to technology strategy and execution.',
        after: 'Engineering executive built for platform modernization: monoliths into cloud-native services, distributed teams past sixty engineers, and P&L ownership at eighteen million. I bring governance that holds under audit, cycle time reduction inside regulated delivery, and the habit of turning technology investment into operational efficiency, enterprise transformation, and revenue growth a board can see quarter after quarter.',
        why: 'Same stored value as the full resume.' },
      { id: 'A2', field: 'SkillsBullets', slot: 'ATS keyword block', type: 'pipe', dynamic: true, edited: true, pass: 3, rule: 'pipe separated, < 30 chars per term',
        reqs: ['M1', 'M2', 'M3', 'M4', 'M5', 'N1', 'N3', 'D3'], terms: ['T1', 'T2', 'T3', 'T4', 'T5', 'T7', 'T8', 'T9', 'T11', 'T12', 'T13'],
        before: 'Enterprise Governance | Technology Strategy | Agile Transformation | Digital Transformation | Risk Management | M&A Due Diligence | AI/ML Strategy',
        after: 'Platform Modernization | Cloud-native Services | SOC 2 Type II | ISO 27001 | Distributed Teams | P&L Ownership | Board Reporting | Kubernetes | Multi-region AWS | Cycle Time Reduction | Safety-critical Systems',
        why: 'Skills 1 and 2 merged into one block, per the compact template.' },
      { id: 'A3', field: 'ExpertiseBullets', slot: 'Expertise', type: 'list', dynamic: true, edited: true, pass: 1, rule: '6 phrases, exactly 5 words',
        reqs: ['M5'], terms: ['T5'], items: [
          { orig: 'Budget Development and P&L Management', final: 'Budget development and P&L ownership', action: 'swapped', req: 'M5', term: 'T5', why: 'Same stored value as the full resume.' },
          { orig: 'KPI-driven performance management', final: 'KPI driven engineering performance management', action: 'swapped', why: 'Same stored value.' },
          { orig: 'Enterprise alignment of strategy and execution', final: 'Enterprise strategy and execution alignment', action: 'swapped', req: 'D2', why: 'Same stored value.' },
          { orig: 'Governance frameworks for compliance', final: 'Governance frameworks for audit compliance', action: 'swapped', req: 'M2', why: 'Same stored value.' },
          { orig: 'Optimizing scaled agile operations', final: 'Optimizing scaled software delivery operations', action: 'swapped', req: 'M4', why: 'Same stored value.' },
          { orig: 'Strategic roadmaps for customer-centric innovation', final: 'Strategic roadmaps with product partnership', action: 'swapped', req: 'D2', why: 'Same stored value.' },
        ] },
      { id: 'A4', field: 'RelevantBullets1–3', slot: 'Relevant 1–3', type: 'list', dynamic: true, edited: true, pass: 2, rule: 'max 1 item over 20 chars per list',
        reqs: ['M1', 'M2', 'D4'], terms: ['T2', 'T5'], items: [...L('Relevant 1'), ...L('Relevant 2'), ...L('Relevant 3')] },
      { id: 'A5', field: 'SkillsBullets1 / 2', slot: 'Skills 1 and 2', type: 'pipe', dynamic: false, reqs: [], terms: [], sameAsBefore: true,
        after: '{{SkillsBullets1}} → ""\n{{SkillsBullets2}} → ""',
        before: '{{SkillsBullets1}} → ""\n{{SkillsBullets2}} → ""',
        why: 'Both fields are sent empty because the compact template uses the single pipe block instead. Empty values are kept rather than removed, so any placeholder left in the template stays visible on the page.' },
    ] },
  cover: {
    label: 'Cover letter', kind: 'letter', target: 'Google Slides · 3 merge fields',
    sections: [
      { id: 'C1', field: '@CoverLetterBody', slot: 'Letter body', type: 'text', dynamic: true, edited: true, pass: 3, rule: '250–400 words, one page',
        reqs: ['D1', 'M1', 'M2', 'M4', 'M5', 'D2'], terms: ['T1', 'T4', 'T2', 'T3', 'T11', 'T6'],
        before: "Resideo's commitment to driving smart home innovation and enterprise-scale digital transformation resonates deeply with my leadership approach. As a technology executive with a track record of optimizing SaaS ecosystems and leading large-scale software organizations, I bring deep expertise in scalable software engineering and enterprise-wide transformation.",
        after: "SafetyIQ's platform sits in front of 400+ industrial operators, and the next phase is platform modernization across three business units. That is the work I have led twice, and the second time went faster because of what the first one cost me. The pattern is the same: one platform, three sets of stakeholders, and a delivery calendar nobody wants to slip.\n\nI have run distributed teams past sixty engineers across three time zones against an $18M engineering budget, with roadmap alignment held jointly with Product and committed dates that stood four quarters running. That last part is the one I would want you to check with references.\n\nCycle time reduction is where regulated environments usually stall, because every control looks like a reason to slow down. My teams cut time to market forty percent without loosening one of them, and the audit findings went down rather than up over the same period.\n\nOn governance, I have owned SOC 2 Type II and ISO 27001 through audit, with security practice inside the delivery cycle rather than bolted on afterwards. On platform, I moved seventy percent of an acquired estate onto multi-region AWS and Kubernetes at 99.99% uptime while cutting infrastructure spend thirty percent.\n\nI report comfortably at board level and I am equally comfortable in a standup, which matters here because the CTO needs a partner who can carry one story to both rooms. If you see a fit, I would welcome an initial conversation about where the platform needs to be twelve months out.",
        why: 'One field carries the whole letter, so structure is the model\'s, not the template\'s.' },
      { id: 'C2', field: '@Company', slot: 'Company', type: 'text', dynamic: true, edited: true, pass: 1, reqs: [], terms: [],
        before: 'Resideo', after: 'SafetyIQ', why: 'Parsed target company.' },
      { id: 'C3', field: '@CoverLetterDate', slot: 'Date', type: 'text', dynamic: true, edited: true, pass: 1, reqs: [], terms: [],
        before: 'April 2, 2025', after: 'August 18, 2026', why: 'Full month name, day, year, per the prompt.' },
      { id: 'C4', field: null, slot: 'Letterhead, signature, layout', type: 'text', dynamic: false, reqs: [], terms: [], sameAsBefore: true,
        after: 'VON ROBERTS\nAustin, TX · von@enterpriseds.io · (512) 555-0148\n\n{{@CoverLetterDate}}\n\nHiring Committee\n{{@Company}}\n\nDear Hiring Committee,\n\n{{@CoverLetterBody}}\n\nSincerely,\nVon Roberts',
        before: 'VON ROBERTS\nAustin, TX · von@enterpriseds.io · (512) 555-0148\n\n{{@CoverLetterDate}}\n\nHiring Committee\n{{@Company}}\n\nDear Hiring Committee,\n\n{{@CoverLetterBody}}\n\nSincerely,\nVon Roberts',
        why: 'The slide frame around the three merge fields. No field of its own, so it is identical in every packet — shown here so you can see where the merged text lands.' },
    ] },
  portfolio: {
    label: 'Portfolio', kind: 'deck', target: 'Google Slides · 7 merge fields',
    sections: [
      { id: 'P1', field: '@AboutMe1_50words', slot: 'About me 1', type: 'text', dynamic: true, edited: true, pass: 1, rule: '45–48 words, past tense',
        reqs: ['D3', 'M3'], terms: ['T7', 'T1'],
        before: 'I have always maintained the philosophy that innovation flourishes when vision, strategy, and execution move in lockstep, driving continuous progress. Throughout my career, I have championed technology as a force multiplier for business growth, operational efficiency, and customer impact.',
        after: 'I have always believed platform modernization is a business act before a technical one. I have worked where engineering investment meets board reporting, holding both in the same sentence, because that is where technology stops being a cost line and starts compounding into something a company can bank.',
        why: 'Past tense, belief-led, per the prompt.' },
      { id: 'P2', field: '@AboutMe2_60words', slot: 'About me 2', type: 'text', dynamic: true, edited: true, pass: 2, rule: '75–80 words, begins "My career"',
        reqs: ['M1', 'M4'], terms: ['T4', 'T11'],
        before: 'My career has been defined by leading global organizations through complex transformations with a balance of strategic foresight and hands-on execution. From modernizing enterprise platforms to integrating advanced analytics and automation, I have driven measurable outcomes.',
        after: 'My career has been distributed teams past sixty engineers, regulated delivery, and the unglamorous work of cycle time reduction. I took the view that controls and speed are not a trade, and the numbers followed: forty percent faster to market, uptime at four nines, infrastructure spend down thirty percent. I thrive where platform strategy has to survive an audit and a board meeting in the same week, and where the engineers doing the work can see why.',
        why: 'Opens with "My career", career-focused, per the prompt.' },
      { id: 'P3', field: '@ExecutiveProfile_55words', slot: 'Executive profile', type: 'text', dynamic: true, edited: true, pass: 2, rule: '50–55 words',
        reqs: ['M1', 'M3', 'M5'], terms: ['T4', 'T1', 'T5'],
        before: 'I am a results-driven technology leader with a track record of driving large-scale digital transformation, enterprise software innovation, and strategic decision-making.',
        after: 'An engineering leader with a record of platform modernization to cloud-native services, distributed teams past sixty engineers, and P&L ownership of eighteen million held to plan. Steady in regulated delivery, measured by cycle time and audit outcomes rather than activity, and comfortable carrying the same story to the board and the standup.',
        why: 'Confident, not self-promoting; avoids the flagged vocabulary.' },
      { id: 'P4', field: '@CoreAccomplishments_5blts_180words', slot: 'Core accomplishments', type: 'select', dynamic: true, edited: false, pass: 1, rule: '5 selected, 98–125 words',
        reqs: ['M2', 'M3', 'M4', 'N1', 'D3'], terms: [],
        items: [
          { text: 'Led a multi-year digital transformation, enhancing platform interoperability, customer-centric product roadmaps, and SaaS scalability, reducing $3M in costs and accelerating cross-unit collaboration.', req: 'M3', selected: true },
          { text: 'Executed a cloud migration strategy for an acquired business, transitioning 70% of infrastructure to AWS, improving security and compliance at 99.99% uptime, while reducing infrastructure spend by 30%.', req: 'N1', selected: true },
          { text: 'Established a security-first engineering culture, embedding DevSecOps practices within SDLC workflows, reducing compliance risks by 40%, and strengthening policies for regulatory alignment.', req: 'M2', selected: true },
          { text: 'Led an enterprise-wide Agile transformation, ensuring requirements alignment and architecture compliance from kickoff to deployment, reducing time-to-market by 40%.', req: 'M4', selected: true },
          { text: 'Collaborated with the CTO and CPO on a 3-year technology roadmap, aligning engineering investment with growth and securing a $13M budget increase.', req: 'D3', selected: true },
          { text: 'Designed and implemented OKRs and monthly executive ops reviews, increasing engineering efficiency and aligning execution with business goals.', req: 'D2', selected: false },
          { text: 'Developed a predictive analytics and reporting platform, automating governance processes using ML and AI, increasing decision-making efficiency by 80%.', req: null, selected: false },
          { text: 'Orchestrated high-value strategic partnerships and M&A integrations, aligning technology ecosystems and reducing time-to-market for acquired solutions by 15%.', req: null, selected: false, blocked: 'omission list' },
        ],
        why: 'Chosen, not rewritten. The five closest stored accomplishments are selected and mapped to the line each one answers; wording stays as you wrote it.' },
      { id: 'P5', field: '@Company / @CoverLetterDate / @CoverLetterBody', slot: 'Company, date, letter body', type: 'text', dynamic: true, edited: true, pass: 1, reqs: ['D1'], terms: [],
        before: 'Resideo · April 2, 2025 · previous letter body', after: 'SafetyIQ · August 18, 2026 · same body as the cover letter',
        why: 'Shared with the cover letter so the two cannot drift.' },
      { id: 'P6', field: null, slot: 'Skills shown on the deck', type: 'select', dynamic: false, reqs: [], terms: [],
        items: [
          { text: 'Platform Architecture', req: 'M3', selected: true },
          { text: 'Cloud Computing', req: 'M3', selected: true },
          { text: 'Kubernetes', req: 'N1', selected: true },
          { text: 'Amazon Web Services (AWS)', req: 'N1', selected: true },
          { text: 'Cybersecurity', req: 'M2', selected: true },
          { text: 'IT Risk Management', req: 'M2', selected: true },
          { text: 'P&L Management', req: 'M5', selected: true },
          { text: 'High Performance Teams', req: 'M1', selected: true },
          { text: 'Engineering Management', req: 'M1', selected: false },
          { text: 'Data Governance', req: null, selected: false },
          { text: 'Machine Learning', req: null, selected: false },
          { text: 'Master Data Management', req: null, selected: false },
          { text: 'Microsoft Azure', req: null, selected: false },
          { text: 'Negotiation', req: null, selected: false },
          { text: 'Mentoring', req: null, selected: false },
          { text: 'ITIL', req: null, selected: false },
        ],
        why: 'Static in the template, so swap by hand. Mapped the same way as the accomplishments so you can see what each one answers.' },
      { id: 'P7', field: null, slot: 'Slide layouts, case studies, title art', type: 'text', dynamic: false, reqs: [], terms: [], sameAsBefore: true,
        after: '01 Title — name, target role, {{@Company}}\n02 About me — {{@AboutMe1_50words}} + portrait\n03 Executive profile — {{@ExecutiveProfile_55words}}\n04 Career — {{@AboutMe2_60words}}\n05 Accomplishments — {{@CoreAccomplishments_5blts_180words}}\n06 Skills grid — static chip set\n07–09 Case studies — three fixed studies (Cloud migration · Agile transformation · Analytics platform)\n10 Letter — {{@CoverLetterBody}}',
        before: '01 Title — name, target role, {{@Company}}\n02 About me — {{@AboutMe1_50words}} + portrait\n03 Executive profile — {{@ExecutiveProfile_55words}}\n04 Career — {{@AboutMe2_60words}}\n05 Accomplishments — {{@CoreAccomplishments_5blts_180words}}\n06 Skills grid — static chip set\n07–09 Case studies — three fixed studies (Cloud migration · Agile transformation · Analytics platform)\n10 Letter — {{@CoverLetterBody}}',
        why: 'Ten fixed slides. The three case studies are the same three in every packet, whatever the posting asks for.' },
    ] },
};

// Check names taken from the prompts' own QA sections.
const CHECKS = [
  { a: 'resume', key: 'ATS distribution', engine: 'rules', label: 'Every library keyword lands in a field', state: 'pass', observed: '12 of 13', expected: '13 or an open item', offenders: ['FedRAMP — open, no profile evidence'] },
  { a: 'resume', key: 'Missing ATS skills', engine: 'rules', label: 'No keyword left uncovered without a note', state: 'pass', observed: '1 open, noted', expected: 'all covered or noted' },
  { a: 'resume', key: 'Summary validation', engine: 'reviewer', label: 'Summary covers the extracted requirement list', state: 'pass', observed: '9 of 12 named, 3 carried elsewhere', expected: 'no requirement unaccounted for' },
  { a: 'resume', key: 'Swap trace', engine: 'reviewer', label: 'Every swap cites the keyword it covers', state: 'pass', observed: '27 of 27', expected: 'all' },
  { a: 'resume', key: 'Style', engine: 'rules', label: 'No AI-tell vocabulary, no em-dashes', state: 'pass', observed: '0 hits', expected: '0' },
  { a: 'resume', key: 'Template reach', engine: 'rules', label: 'No requirement rests only on static text', state: 'warn', observed: '2 rely on figures the static bullets omit', expected: '0', offenders: ['M1 — bullets say “globally distributed”, no headcount', 'M5 — no budget figure in bullets'] },

  { a: 'compact_resume', key: 'ATS distribution', engine: 'rules', label: 'Every library keyword lands in a field', state: 'fail', observed: '11 of 13', expected: '13 or an open item', offenders: ['FedRAMP — open', 'Roadmap Alignment — cut for length, not noted'] },
  { a: 'compact_resume', key: 'Word & char check', engine: 'rules', label: 'Keyword block fits one page', state: 'pass', observed: '1,042 chars', expected: '≤ 1,100' },
  { a: 'compact_resume', key: 'Empty fields', engine: 'rules', label: 'No empty merge field left visible', state: 'warn', observed: 'Skills 1 and 2 sent empty, template keeps empties', expected: '0', offenders: ['SkillsBullets1', 'SkillsBullets2'] },
  { a: 'compact_resume', key: 'Swap trace', engine: 'reviewer', label: 'Every swap cites the keyword it covers', state: 'pass', observed: 'all', expected: 'all' },

  { a: 'cover', key: 'Company check', engine: 'rules', label: 'Target company named, no stale names', state: 'pass', observed: 'SafetyIQ ×2', expected: 'no stale company' },
  { a: 'cover', key: 'ATS distribution', engine: 'rules', label: 'Keywords present in the body', state: 'pass', observed: '6 of 13 (letter is prose)', expected: 'no hard target' },
  { a: 'cover', key: 'Style', engine: 'rules', label: 'No AI-tell vocabulary, no em-dashes', state: 'pass', observed: '0 hits', expected: '0' },

  { a: 'portfolio', key: 'Word & char check', engine: 'rules', label: 'About me 2 opens “My career”', state: 'pass', observed: 'opens correctly', expected: 'exact opener' },
  { a: 'portfolio', key: 'Style', engine: 'rules', label: 'Hyphen and code-fence residue removed', state: 'pass', observed: '0', expected: '0' },
];

// Word-rule checks are computed from the strings themselves, so the number in a
// check row can never disagree with the number rendered beside the field.
const WORD_RULES = [
  { a: 'resume', id: 'R1', label: 'Resume summary', min: 55, max: 60 },
  { a: 'compact_resume', id: 'A1', label: 'Resume summary', min: 55, max: 60 },
  { a: 'cover', id: 'C1', label: 'Letter body', min: 250, max: 400 },
  { a: 'portfolio', id: 'P1', label: 'About me 1', min: 45, max: 48 },
  { a: 'portfolio', id: 'P2', label: 'About me 2', min: 75, max: 80 },
  { a: 'portfolio', id: 'P3', label: 'Executive profile', min: 50, max: 55 },
  { a: 'portfolio', id: 'P4', label: 'Core accomplishments', min: 98, max: 125, list: true },
];

const secText = (sec, listMode) => sec.type === 'select'
  ? sec.items.filter(i => i.selected).map(i => i.text).join(' ')
  : (listMode ? sec.items.map(i => i.final).filter(Boolean).join(' ') : sec.after);

WORD_RULES.forEach(r => {
  const sec = ASSET_DOCS[r.a].sections.find(s => s.id === r.id);
  if (!sec) return;
  const text = secText(sec, r.list);
  const n = w(text);
  const ok = n >= r.min && n <= r.max;
  sec.words = n; sec.wordState = ok ? 'pass' : 'warn';
  CHECKS.push({
    a: r.a, key: 'Word & char check', engine: 'rules', sec: r.id,
    label: `${r.label} · ${r.min}–${r.max} words`,
    state: ok ? 'pass' : 'warn',
    observed: `${n} words`, expected: `${r.min}–${r.max}`,
  });
});

// Which keywords a field claims but does not actually contain.
Object.keys(ASSET_DOCS).forEach(type => {
  ASSET_DOCS[type].sections.forEach(s => {
    if (!s.dynamic || !(s.terms || []).length) return;
    const hay = ((s.type === 'select' ? s.items.filter(i => i.selected).map(i => i.text).join(' ') : s.type === 'list' ? (s.items || []).map(i => i.final).join(' ') : s.after) || '').toLowerCase();
    s.missingTerms = s.terms.filter(id => { const t = termById(id); return t && !hay.includes(t.term.toLowerCase()); });
  });
  const claimed = ASSET_DOCS[type].sections.reduce((a, s) => a.concat(s.missingTerms || []), []);
  if (claimed.length) {
    CHECKS.push({
      a: type, key: 'ATS distribution', engine: 'rules',
      label: 'Keywords claimed by a field appear in its text', state: 'warn',
      observed: `${claimed.length} claimed but absent`, expected: '0',
      offenders: [...new Set(claimed)].map(id => termById(id)?.term).filter(Boolean),
    });
  }
});

function ruleStateFor(type, secId) {
  const c = CHECKS.find(x => x.a === type && x.sec === secId);
  return c ? c.state : null;
}

// Per-item list rules — phrase length and character limits — derived the same way.
const LIST_RULES = [
  { a: 'resume', id: 'R4', kind: 'phrase5' },
  { a: 'compact_resume', id: 'A3', kind: 'phrase5' },
  { a: 'resume', id: 'R2', kind: 'chars', max: 24 },
  { a: 'resume', id: 'R3', kind: 'chars', max: 24 },
  { a: 'resume', id: 'R5', kind: 'over20' },
  { a: 'resume', id: 'R6', kind: 'over20' },
  { a: 'resume', id: 'R7', kind: 'over20' },
  { a: 'compact_resume', id: 'A4', kind: 'over20' },
];

LIST_RULES.forEach(r => {
  const sec = ASSET_DOCS[r.a].sections.find(s => s.id === r.id);
  if (!sec || !sec.items) return;
  const finals = sec.items.map(i => i.final).filter(Boolean);
  let ok, observed, label, expected, offenders = null;
  if (r.kind === 'phrase5') {
    const counts = finals.map(f => w(f));
    ok = finals.length === 6 && counts.every(c => c === 5);
    observed = ok ? `${finals.length} × 5 words` : `${finals.length} phrases · ${counts.join('/')} words`;
    label = `${sec.slot} · 6 phrases, exactly 5 words`;
    expected = '6 × 5';
    if (!ok) offenders = finals.filter(f => w(f) !== 5);
  } else if (r.kind === 'chars') {
    const over = finals.filter(f => f.length > r.max);
    ok = over.length === 0;
    observed = `longest ${Math.max.apply(null, finals.map(f => f.length))} chars`;
    label = `${sec.slot} · every item ≤ ${r.max} chars`;
    expected = `≤ ${r.max}`;
    if (!ok) offenders = over.map(f => `${f} (${f.length})`);
  } else {
    const over = finals.filter(f => f.length > 20);
    ok = over.length <= 1;
    observed = `${over.length} over 20 chars`;
    label = `${sec.slot} · max 1 item over 20 chars`;
    expected = '≤ 1';
    if (!ok) offenders = over.map(f => `${f} (${f.length})`);
  }
  sec.ruleObserved = observed;
  CHECKS.push({ a: r.a, key: 'Word & char check', engine: 'rules', sec: r.id, label, state: ok ? 'pass' : 'warn', observed, expected, offenders });
});

// ── Mirroring check ────────────────────────────────────────────────────────
// Phrases a hiring manager would notice as lifted straight from their own ad.
// Figures are not a judgement call: an exact number lifted from the ad — "$18M",
// "60+", "three business units" — is the posting's own figure, not evidence of
// anything you did. Rather than leaving it for you to clean up, each one is
// CORRECTED before you see it: the ad's figure is replaced with your own figure
// from the profile, or generalized. The correction is listed and revertible.
const MIRROR_WATCH = [
  { phrase: 'three business units', kind: 'figure', posting: 'across three business units', fix: 'multiple business units', why: 'Generalized — the count is theirs.' },
  { phrase: 'sixty engineers', kind: 'figure', posting: 'a distributed organization of 60+', fix: 'sixty-two engineers', why: 'Replaced with your own headcount from the profile (62).' },
  { phrase: '60+', kind: 'figure', posting: 'a distributed organization of 60+', fix: '62', why: 'Replaced with your own headcount from the profile.' },
  { phrase: '$18M', kind: 'figure', posting: 'roughly $18M annually', fix: '8-figure', why: 'Generalized — the ad names this figure itself.' },
  { phrase: 'eighteen million', kind: 'figure', posting: 'roughly $18M annually', fix: 'eight figures', why: 'Generalized — the ad names this figure itself.' },
  { phrase: '400+ industrial operators', kind: 'figure', posting: 'used by 400+ industrial operators', fix: 'a large industrial operator base', why: 'Their customer count, not your evidence.' },
  { phrase: 'safety-critical', kind: 'phrase', posting: 'safety-critical domain background', fix: null, why: 'Domain term, not a figure — your call.' },
];

const MIRRORS = [];
Object.keys(ASSET_DOCS).forEach(type => {
  ASSET_DOCS[type].sections.forEach(s => {
    if (!s.dynamic) return;
    const text = secText(s, s.type === 'list');
    if (!text) return;
    const hits = MIRROR_WATCH.filter(m => text.toLowerCase().includes(m.phrase.toLowerCase()));
    if (!hits.length) return;
    s.mirrors = hits;
    hits.forEach(h => MIRRORS.push({ a: type, sec: s.id, slot: s.slot, ...h }));
    const figs = hits.filter(h => h.kind === 'figure');
    if (figs.length) CHECKS.push({
      a: type, key: 'Mirroring', engine: 'rules', sec: s.id, fixed: true,
      label: `${s.slot} · posting figures rewritten`, state: 'pass',
      observed: `${figs.length} corrected automatically`, expected: '0 exact figures from the ad',
      offenders: figs.map(f => `“${f.phrase}” → “${f.fix}”`),
    });
  });
  const soft = MIRRORS.filter(m => m.a === type && m.kind === 'phrase');
  if (soft.length) {
    CHECKS.push({
      a: type, key: 'Mirroring', engine: 'reviewer',
      label: 'Posting wording echoed, no figures', state: 'pass',
      observed: `${soft.length} echo${soft.length > 1 ? 'es' : ''}, accepted`, expected: 'your call',
      offenders: soft.map(m => `${m.phrase} — ${m.slot}`),
      soft: true,
    });
  }
});

// Wording that differs from the library term but counts as the same competency.
['resume', 'compact_resume', 'cover', 'portfolio'].forEach(type => {
  const variants = ATS_TERMS.filter(t => t.match === 'variant' && ASSET_DOCS[type].sections.some(s => (s.terms || []).includes(t.id)));
  const loose = ATS_TERMS.filter(t => t.match === 'loose' && ASSET_DOCS[type].sections.some(s => (s.terms || []).includes(t.id)));
  if (variants.length) {
    CHECKS.push({
      a: type, key: 'Match quality', engine: 'reviewer',
      label: 'Reworded rather than copied from the posting', state: 'pass',
      observed: `${variants.length} of ${variants.length + ATS_TERMS.filter(t => t.match === 'exact').length} keywords reworded`,
      expected: 'exact only for named standards and products',
      offenders: variants.map(t => t.term), soft: true,
    });
  }
  if (loose.length) {
    CHECKS.push({
      a: type, key: 'Match quality', engine: 'reviewer',
      label: 'Loose matches — accepted, no score credit', state: 'pass',
      observed: `${loose.length} loose`, expected: 'your call',
      offenders: loose.map(t => `${t.term} (${t.used})`), soft: true,
    });
  }
});

const OPEN_ITEMS = [
  { id: 'E1', req: 'N2', term: 'T10', artifact: 'compact_resume', sec: 'A2',
    title: 'FedRAMP has no evidence in your profile',
    detail: 'Listed as nice-to-have and matched in the library, so it counts as a gap. Three passes found nothing to support it.',
    ask: 'Any public-sector or FedRAMP-adjacent work?' },
  { id: 'E2', req: 'M1', term: 'T4', artifact: 'resume', sec: 'R8',
    title: 'Two must-haves live only in generated fields',
    detail: 'The 60+ headcount and the $18M budget appear in the summary and lists, but the static work-history bullets still read “globally distributed” with no figures.',
    ask: 'Update the template bullets once, or add a work-history merge field?' },
];

const VERDICTS = {
  resume: { grade: 'A-', promptVersion: 'reviewer v003', blind: true, agree: 27, total: 27, ranAt: '09:16',
    citations: [
      { req: 'M3', quote: 'Experience modernizing a monolithic platform to cloud-native services', claim: 'Summary and Skills 1 both carry it; evidenced by the AWS migration.' },
      { req: 'M1', quote: 'including a distributed organization of 60+', claim: 'Summary states past sixty. Static bullets do not.' },
      { req: 'M5', quote: 'P&L or budget ownership at $10M or above', claim: '$18M in summary and Relevant 3.' },
      { req: 'M4', quote: 'reducing delivery cycle time in a regulated environment', claim: '40% gain tied to audit obligations.' },
    ],
    critique: [
      { s: 'ok', t: 'Every claim traces to the profile. No invented figures.' },
      { s: 'warn', t: 'Generated fields carry the tailoring because work history cannot change. A reader may notice the gap between summary and bullets.' },
    ] },
  compact_resume: { grade: 'B+', promptVersion: 'reviewer v003', blind: true, agree: 27, total: 27, ranAt: '09:16',
    citations: [
      { req: 'M2', quote: 'SOC 2 Type II and ISO 27001', claim: 'Both in the keyword block.' },
      { req: 'M1', quote: 'a distributed organization of 60+', claim: 'Summary line.' },
    ],
    critique: [
      { s: 'fail', t: 'Roadmap Alignment was cut for length with no note. Length pressure is not the same as an honest gap.' },
      { s: 'warn', t: 'Skills 1 and 2 are sent empty while the template keeps empties.' },
    ] },
  cover: { grade: 'A', promptVersion: 'reviewer v003', blind: true, agree: 6, total: 6, ranAt: '09:17',
    citations: [
      { req: 'M1', quote: 'a distributed organization of 60+', claim: 'Second paragraph.' },
      { req: 'M4', quote: 'reducing delivery cycle time in a regulated environment', claim: 'Second paragraph, closing line.' },
      { req: 'D1', quote: 'Lead modernization of our core safety platform across three business units', claim: 'Opening line.' },
    ],
    critique: [{ s: 'ok', t: 'Strongest asset. The stale company name from the sample was caught.' }] },
  portfolio: { grade: 'B+', promptVersion: 'reviewer v003', blind: true, agree: 5, total: 5, ranAt: '09:17',
    citations: [{ req: 'D3', quote: 'present platform strategy to the board quarterly', claim: 'About me 1 is built on it.' }],
    critique: [{ s: 'warn', t: 'Three passages sit under their word floors. The template will show gaps.' }] },
};

const SCORES = {
  resume: { must: 100, kw: 92, sen: 96, composite: 97, open: ['N2'] },
  compact_resume: { must: 100, kw: 85, sen: 92, composite: 94, open: ['N2', 'D2'] },
  cover: { must: 100, kw: 88, sen: 98, composite: 96, open: ['N2'] },
  portfolio: { must: 100, kw: 82, sen: 94, composite: 94, open: ['N2'] },
};

const ARTIFACTS = [
  { id: 'a1', type: 'resume', status: 'review', docUrl: 'https://docs.google.com/document/d/demo-resume' },
  { id: 'a2', type: 'compact_resume', status: 'review', docUrl: 'https://docs.google.com/document/d/demo-ats' },
  { id: 'a3', type: 'cover', status: 'approved', docUrl: 'https://docs.google.com/presentation/d/demo-cover' },
  { id: 'a4', type: 'portfolio', status: 'review', docUrl: 'https://docs.google.com/presentation/d/demo-portfolio' },
  { id: 'a5', type: 'video', status: 'todo' },
];

function gateFor(type) {
  const cs = CHECKS.filter(c => c.a === type);
  if (!cs.length) return null;
  if (cs.some(c => c.state === 'fail')) return 'fail';
  if (cs.some(c => c.state === 'warn')) return 'warn';
  return 'pass';
}
function checkCounts(type) {
  const cs = CHECKS.filter(c => c.a === type);
  return { pass: cs.filter(c => c.state === 'pass').length, warn: cs.filter(c => c.state === 'warn').length, fail: cs.filter(c => c.state === 'fail').length, total: cs.length };
}
function libTerms() { return ATS_TERMS.filter(t => t.source === 'library'); }
function modelTerms() { return ATS_TERMS.filter(t => t.source === 'model'); }
function termById(id) { return ATS_TERMS.find(t => t.id === id); }
function reqById(id) { return REQUIREMENTS.find(r => r.id === id); }
function coverage(type) {
  const doc = ASSET_DOCS[type]; if (!doc) return null;
  const reqs = new Set(), terms = new Set();
  doc.sections.forEach(s => { (s.reqs || []).forEach(r => reqs.add(r)); (s.terms || []).forEach(t => terms.add(t)); });
  const dyn = doc.sections.filter(s => s.dynamic).length;
  return { reqs: reqs.size, allReq: REQUIREMENTS.length, terms: terms.size, allTerm: libTerms().length, dyn, statics: doc.sections.length - dyn };
}
const GATE_COLOR = { pass: 'var(--proto-green)', warn: 'var(--proto-yellow)', fail: 'var(--proto-red)' };
const GATE_SOFT = { pass: 'var(--proto-green-soft)', warn: 'var(--proto-yellow-soft)', fail: 'var(--proto-red-soft)' };
const COV_COLOR = { covered: 'var(--proto-green)', open: 'var(--proto-red)' };

const PACKET_GATE = (() => {
  const g = ['resume', 'compact_resume', 'cover', 'portfolio'].map(gateFor);
  return g.includes('fail') ? 'fail' : g.includes('warn') ? 'warn' : 'pass';
})();
const PACKET_SCORE = Math.round(['resume', 'compact_resume', 'cover', 'portfolio'].reduce((a, t) => a + SCORES[t].composite, 0) / 4);

// ── Posting vs profile ────────────────────────────────────────────────────
// The comparison the JD step is meant to show: what the ad asks for, what the
// stored profile actually evidences, and how close those two are.
const FIT_LABEL = { strong: 'Strong match', moderate: 'Moderate match', weak: 'No evidence' };
const FIT_COLOR = { strong: 'var(--proto-green)', moderate: 'var(--proto-yellow)', weak: 'var(--proto-red)' };

const PROFILE_COMPARE = [
  { l: 'Leadership tenure', req: 'M1', posting: '10+ years engineering leadership', yours: '14 years, three companies', fit: 'strong' },
  { l: 'Organization size', req: 'M1', posting: 'Distributed organization of 60+', yours: '62 engineers across three time zones', fit: 'strong' },
  { l: 'Budget owned', req: 'M5', posting: 'P&L or budget ownership at $10M+', yours: '$18M engineering P&L, held to plan', fit: 'strong' },
  { l: 'Compliance ownership', req: 'M2', posting: 'SOC 2 Type II and ISO 27001', yours: 'Both owned through audit', fit: 'strong' },
  { l: 'Platform modernization', req: 'M3', posting: 'Monolith to cloud-native services', yours: 'Two rebuilds; 70% of an estate onto AWS', fit: 'strong' },
  { l: 'Cycle time, regulated', req: 'M4', posting: 'Track record reducing delivery cycle time', yours: '40% faster on one programme, controls intact', fit: 'moderate', note: 'One programme, not a record across roles.' },
  { l: 'Domain background', req: 'N3', posting: 'Industrial, IoT or safety-critical', yours: 'Connected-product platforms, safety-adjacent', fit: 'moderate', note: 'Adjacent domain, not safety-critical certification work.' },
  { l: 'Public sector', req: 'N2', posting: 'FedRAMP or public-sector procurement', yours: 'Nothing found in three passes', fit: 'weak' },
];

const KIND_LABEL = { must_have: 'Must-have', nice_to_have: 'Nice-to-have', responsibility: 'Responsibility' };
const KIND_OF = { M: 'must_have', N: 'nice_to_have', D: 'responsibility' };
function reqKindLabel(id) { const r = reqById(id); return r ? KIND_LABEL[r.kind] : KIND_LABEL[KIND_OF[String(id)[0]]] || ''; }
function reqLabel(id) { const r = reqById(id); return r ? `${r.id} · ${r.competency}` : id; }

function matchRows() {
  const g = (kind) => REQUIREMENTS.filter(r => r.kind === kind);
  const cov = (rows) => rows.filter(r => r.coverage === 'covered').length;
  const lib = libTerms();
  const fit = (n, d) => d === 0 ? 'strong' : n / d >= 0.99 ? 'strong' : n / d >= 0.7 ? 'moderate' : 'weak';
  const rows = [
    { k: 'responsibility', l: 'Responsibilities', sub: 'What you would own day to day' },
    { k: 'must_have', l: 'Must-have requirements', sub: 'Screened on these' },
    { k: 'nice_to_have', l: 'Nice-to-have requirements', sub: 'Tie-breakers' },
  ].map(r => { const rows2 = g(r.k); const n = cov(rows2); return { ...r, n, d: rows2.length, fit: fit(n, rows2.length), missing: rows2.filter(x => x.coverage !== 'covered') }; });
  const n = lib.filter(t => t.status !== 'open').length;
  rows.push({ k: 'keywords', l: 'ATS keywords', sub: `${TERM_LIB.id} library`, n, d: lib.length, fit: fit(n, lib.length), missing: lib.filter(t => t.status === 'open') });
  return rows;
}

// ── Needs your attention ──────────────────────────────────────────────────
// One flat list, built from the checks, the open items and the unscored
// matches, each carrying the asset and field it lives in so a click can land
// on it instead of opening a search.
const SEC_HINT = { 'resume|Template reach': 'R8', 'compact_resume|Empty fields': 'A5', 'compact_resume|ATS distribution': 'A2', 'compact_resume|Word & char check': 'A2' };
const ATTENTION = [];
CHECKS.filter(c => !c.soft && c.state !== 'pass').forEach((c, i) => ATTENTION.push({
  id: 'K' + i, sev: c.state, asset: c.a, sec: c.sec || SEC_HINT[c.a + '|' + c.key] || null, title: c.label, group: c.key,
  detail: (c.offenders && c.offenders.length) ? c.offenders.join(' · ') : `${c.observed} · target ${c.expected}`,
}));
OPEN_ITEMS.forEach(e => ATTENTION.push({ id: e.id, sev: 'open', asset: e.artifact, sec: e.sec, title: e.title, detail: e.detail, ask: e.ask, req: e.req, group: 'Open question' }));
ATS_TERMS.filter(t => t.match === 'loose').forEach(t => ATTENTION.push({
  id: 'L' + t.id, sev: 'soft', asset: 'resume', sec: null, term: t.id, group: 'Unscored match',
  title: `${t.term} earns no score credit`, detail: t.note,
}));
MIRRORS.filter(m => m.kind === 'figure').forEach((m, i) => ATTENTION.push({
  id: 'F' + i, sev: 'fixed', asset: m.a, sec: m.sec, group: 'Corrected before you saw it',
  title: `“${m.phrase}” rewritten as “${m.fix}” in ${m.slot}`, detail: m.why,
}));
const SEV_ORDER = { fail: 0, open: 1, warn: 2, fixed: 3, soft: 4 };
ATTENTION.sort((a, b) => SEV_ORDER[a.sev] - SEV_ORDER[b.sev]);
const SEV_LABEL = { fail: 'Fix before approval', open: 'Needs your answer', warn: 'Review', fixed: 'Corrected for you', soft: 'Your call' };
const SEV_COLOR = { fail: 'var(--proto-red)', open: 'var(--proto-red)', warn: 'var(--proto-yellow)', fixed: 'var(--proto-green)', soft: 'var(--proto-ink3)' };
const SEV_SOFT = { fail: 'var(--proto-red-soft)', open: 'var(--proto-red-soft)', warn: 'var(--proto-yellow-soft)', fixed: 'var(--proto-green-soft)', soft: 'var(--proto-panel)' };
const attentionFor = (type, sec) => ATTENTION.filter(a => (!type || a.asset === type) && (!sec || a.sec === sec));

Object.assign(window, {
  PACKET, TERM_LIB, POSTING, REQUIREMENTS, ATS_TERMS, PASSES, SKILL_ROWS, SKILL_BANK, ASSET_DOCS, CHECKS, OPEN_ITEMS, VERDICTS, SCORES, ARTIFACTS,
  gateFor, checkCounts, coverage, libTerms, modelTerms, termById, reqById, wordCount: w, ruleStateFor, MIRRORS,
  GATE_COLOR, GATE_SOFT, COV_COLOR, PACKET_GATE, PACKET_SCORE,
  PROFILE_COMPARE, FIT_LABEL, FIT_COLOR, KIND_LABEL, reqKindLabel, reqLabel, matchRows,
  ATTENTION, SEV_LABEL, SEV_COLOR, SEV_SOFT, attentionFor,
});
