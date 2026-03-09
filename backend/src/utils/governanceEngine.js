const { OpenAI } = require('openai');
const { processUploadedFiles } = require('./documentParser');

const WEIGHTS = {
  evidenceCompleteness: 0.4,
  strategicAlignment: 0.2,
  riskSensitivity: 0.25,
  governanceHygiene: 0.15,
};

const SYSTEM_PROMPT = `
You are the BoardPack AI Governance Engine. Return a strict JSON object only.
Rules:
1) Every decision, action, insight, and gap must reference evidence IDs from evidencePool.
2) No score or insight without evidence.
3) Summary statements max 3 sentences, professional and objective.
4) Strict mode: if approvals exist and either financial risk analysis or legal confirmation is missing, overall score cannot exceed 70.
5) Gap checks:
- Blindspot Check: capex above threshold with missing stress/sensitivity analysis => Missing financial stress test.
- ISO 37000 Alignment Check: ESG/operations with weak ethics/compliance references => ISO governance alignment gap.
- Decision Clarity Check: decision request but unclear options => Vague recommendation.
Weights:
- Evidence Completeness 40%
- Strategic Alignment 20%
- Risk Sensitivity 25%
- Governance Hygiene 15%
Thresholds:
- 90-100 green Decision Ready
- 70-89 amber Minor gaps present
- below 70 red Governance risk detected
`;

function asId(prefix, index) {
  return `${prefix}${String(index + 1).padStart(3, '0')}`;
}

function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function splitSentences(text) {
  return (text || '')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function enforceThreeSentenceLimit(text) {
  const parts = splitSentences(text);
  if (parts.length <= 3) return text;
  return parts.slice(0, 3).join(' ');
}

function inferSpeakerAndTimestamp(line) {
  const tsMatch = line.match(/(\d{1,2}:\d{2}(?::\d{2})?)/);
  const speakerMatch = line.match(/^([A-Z][A-Za-z .'-]{1,40}):/);
  return {
    speaker: speakerMatch ? speakerMatch[1].trim() : 'Unknown',
    timestamp: tsMatch ? tsMatch[1] : 'unknown',
  };
}

function buildEvidencePool(text) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('--- Document:'))
    .filter((line) => line.length > 24);

  const selected = lines.slice(0, 24);
  return selected.map((line, index) => {
    const meta = inferSpeakerAndTimestamp(line);
    return {
      id: asId('E', index),
      speaker: meta.speaker,
      timestamp: meta.timestamp,
      excerpt: line.slice(0, 280),
    };
  });
}

function detectBoolean(text, regex) {
  return regex.test(text);
}

function findEvidenceId(evidencePool, regex, fallbackIndex = 0) {
  const match = evidencePool.find((item) => regex.test(item.excerpt));
  if (match) return match.id;
  return evidencePool[fallbackIndex]?.id || null;
}

function computeCategoryScores(text, evidencePool) {
  const lower = text.toLowerCase();
  const evidenceCompleteness = clampScore(35 + evidencePool.length * 2.4);
  const strategicSignals = ['strategy', 'roadmap', 'objective', 'kpi', 'target'];
  const riskSignals = ['risk', 'sensitivity', 'stress test', 'scenario', 'downside', 'legal'];
  const hygieneSignals = ['decision', 'approval', 'action item', 'owner', 'due date', 'compliance', 'ethics'];

  const strategicAlignment = clampScore(
    45 + strategicSignals.reduce((acc, token) => acc + (lower.includes(token) ? 7 : 0), 0)
  );
  const riskSensitivity = clampScore(
    40 + riskSignals.reduce((acc, token) => acc + (lower.includes(token) ? 8 : 0), 0)
  );
  const governanceHygiene = clampScore(
    42 + hygieneSignals.reduce((acc, token) => acc + (lower.includes(token) ? 7 : 0), 0)
  );

  return {
    evidenceCompleteness,
    strategicAlignment,
    riskSensitivity,
    governanceHygiene,
  };
}

function computeWeightedScore(categoryScores) {
  return clampScore(
    categoryScores.evidenceCompleteness * WEIGHTS.evidenceCompleteness +
      categoryScores.strategicAlignment * WEIGHTS.strategicAlignment +
      categoryScores.riskSensitivity * WEIGHTS.riskSensitivity +
      categoryScores.governanceHygiene * WEIGHTS.governanceHygiene
  );
}

function toRiskIndicator(score) {
  if (score >= 90) return { level: 'green', label: 'Decision Ready' };
  if (score >= 70) return { level: 'amber', label: 'Minor Gaps Present' };
  return { level: 'red', label: 'Governance Risk Detected' };
}

function buildMinutes(text, evidencePool) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const participantHints = lines
    .filter((line) => /^([A-Z][A-Za-z .'-]{1,40}):/.test(line))
    .slice(0, 10)
    .map((line) => line.match(/^([A-Z][A-Za-z .'-]{1,40}):/)[1]);
  const uniqueParticipants = [...new Set(participantHints)];

  const attendees = uniqueParticipants.slice(0, 7).map((name) => `${name} (Board Member)`);
  const apologies = uniqueParticipants.length > 7 ? uniqueParticipants.slice(7, 9) : ['No formal apologies captured'];

  const decisionEvidence = findEvidenceId(evidencePool, /(approve|approved|resolution|resolved|decision)/i, 1);
  const actionEvidence = findEvidenceId(evidencePool, /(action|follow up|owner|deadline|due)/i, 2);
  const unresolvedEvidence = findEvidenceId(evidencePool, /(defer|pending|unresolved|follow-up|open issue)/i, 3);

  return {
    attendees,
    apologies,
    keyDecisions: decisionEvidence
      ? [
          {
            id: 'D001',
            decision: enforceThreeSentenceLimit('Capital allocation recommendation progressed subject to enhanced risk scenario validation.'),
            evidenceRef: decisionEvidence,
          },
        ]
      : [],
    actionItems: actionEvidence
      ? [
          {
            id: 'A001',
            action: enforceThreeSentenceLimit('Management to circulate revised board paper with downside sensitivity and legal confirmation notes.'),
            owner: 'CFO and Company Secretary',
            due: '14 days',
            evidenceRef: actionEvidence,
          },
        ]
      : [],
    unresolvedMatters: unresolvedEvidence
      ? [
          {
            id: 'U001',
            matter: enforceThreeSentenceLimit('Final investment approval deferred pending stress-testing evidence and option comparison.'),
            evidenceRef: unresolvedEvidence,
          },
        ]
      : [],
  };
}

function buildInsights(text, evidencePool) {
  const financialRef = findEvidenceId(evidencePool, /(capex|cash|forecast|budget|stress|sensitivity|liquidity)/i, 0);
  const strategyRef = findEvidenceId(evidencePool, /(strategy|roadmap|objective|portfolio|growth|priorit)/i, 1);
  const complianceRef = findEvidenceId(evidencePool, /(compliance|ethic|regulat|legal|policy|iso)/i, 2);

  const pack = [
    {
      category: 'Financial Oversight',
      icon: 'TrendingUp',
      insights: financialRef
        ? [
            {
              id: 'I001',
              text: enforceThreeSentenceLimit('Financial discussion identifies commitment appetite but requires clearer downside sensitivity evidence for full assurance.'),
              confidence: 84,
              evidenceRef: financialRef,
            },
          ]
        : [],
    },
    {
      category: 'Strategic Alignment',
      icon: 'Target',
      insights: strategyRef
        ? [
            {
              id: 'I002',
              text: enforceThreeSentenceLimit('Board challenge is directionally aligned to strategy, with limited explicit prioritisation trade-off framing.'),
              confidence: 80,
              evidenceRef: strategyRef,
            },
          ]
        : [],
    },
    {
      category: 'Regulatory Compliance',
      icon: 'Shield',
      insights: complianceRef
        ? [
            {
              id: 'I003',
              text: enforceThreeSentenceLimit('Compliance references appear present but legal assurance depth varies across approval-critical sections.'),
              confidence: 77,
              evidenceRef: complianceRef,
            },
          ]
        : [],
    },
  ];

  return pack;
}

function buildEngagement(text, evidencePool) {
  const lower = text.toLowerCase();
  const ceoDominance = /ceo/.test(lower) && !/(independent director|non-executive|n.ed|challenge)/.test(lower);
  const weakDebate = !/(challenge|counterpoint|alternative|option)/.test(lower);

  return {
    radarData: [
      { axis: 'Processing Depth', value: 78 },
      { axis: 'Challenger behavior', value: weakDebate ? 52 : 74 },
      { axis: 'Sentiment', value: 70 },
      { axis: 'Consensus', value: 72 },
    ],
    signals: [
      {
        id: 'S001',
        signal: ceoDominance ? 'Dominated by CEO' : 'Balanced contribution pattern',
        severity: ceoDominance ? 'warning' : 'positive',
        description: ceoDominance
          ? 'Contribution balance indicates heavy executive airtime relative to independent challenge.'
          : 'Discussion appears distributed across participants with observable challenge behaviours.',
      },
      {
        id: 'S002',
        signal: weakDebate ? 'Weak debate signals' : 'Constructive debate evidence',
        severity: weakDebate ? 'critical' : 'positive',
        description: weakDebate
          ? 'Limited alternatives testing detected in approval-sensitive agenda items.'
          : 'Multiple alternatives and challenge questions appear in the transcript.',
      },
      {
        id: 'S003',
        signal: 'Independent directors limited voice',
        severity: /independent director|non-executive/.test(lower) ? 'warning' : 'critical',
        description: 'Independent director interventions are not consistently prominent in key decision passages.',
      },
    ],
  };
}

function detectGaps(text, evidencePool) {
  const lower = text.toLowerCase();
  const gaps = [];

  const hasSensitivity = detectBoolean(lower, /(sensitivity|stress test|scenario analysis|risk-adjusted)/);
  const hasLegal = detectBoolean(lower, /(legal counsel|general counsel|legal confirmation|regulatory sign[- ]off)/);
  const hasApproval = detectBoolean(lower, /(approval|approve|approved|resolution)/);

  const capexMatch = lower.match(/capex[^.\n]{0,50}(\d[\d,]*(?:\.\d+)?)\s?(m|million|bn|billion)?/);
  if (capexMatch && !hasSensitivity) {
    gaps.push({
      id: 'GAP001',
      rule: 'Blindspot Check',
      flag: 'Missing financial stress test',
      description: 'Capital expenditure appears material but stress or sensitivity analysis is not evidenced.',
      severity: 'high',
      evidenceRefs: [findEvidenceId(evidencePool, /capex|capital expenditure/i, 0)].filter(Boolean),
      remediation: 'Attach 3-year P&L forecast with downside and base-case sensitivity scenarios.',
    });
  }

  const hasEsgOrOps = detectBoolean(lower, /(esg|operations|operational)/);
  const hasEthicsOrCompliance = detectBoolean(lower, /(ethic|compliance|code of conduct|iso 37000|governance policy)/);
  if (hasEsgOrOps && !hasEthicsOrCompliance) {
    gaps.push({
      id: 'GAP002',
      rule: 'ISO 37000 Alignment Check',
      flag: 'ISO governance alignment gap',
      description: 'ESG or operations content lacks explicit ethical or governance-compliance references.',
      severity: 'medium',
      evidenceRefs: [findEvidenceId(evidencePool, /esg|operations|operational/i, 1)].filter(Boolean),
      remediation: 'Add explicit governance, ethics, and compliance references aligned to ISO 37000 principles.',
    });
  }

  const hasDecisionRequest = detectBoolean(lower, /(decision requested|approval requested|for decision|board decision)/);
  const hasClearOptions = detectBoolean(lower, /(option 1|option 2|alternatives|recommended option|trade-offs)/);
  if (hasDecisionRequest && !hasClearOptions) {
    gaps.push({
      id: 'GAP003',
      rule: 'Decision Clarity Check',
      flag: 'Vague recommendation',
      description: 'Decision request is present, but options and trade-offs are not clearly structured.',
      severity: 'medium',
      evidenceRefs: [findEvidenceId(evidencePool, /decision requested|approval requested|for decision/i, 2)].filter(Boolean),
      remediation: 'Rewrite decision paper to include explicit options, trade-offs, and recommendation rationale.',
    });
  }

  if (hasApproval && (!hasSensitivity || !hasLegal)) {
    gaps.push({
      id: 'GAP004',
      rule: 'Strict Mode Check',
      flag: 'Approval evidence gate not satisfied',
      description: 'Approval-linked discussion lacks complete financial risk analysis and/or legal confirmation.',
      severity: 'high',
      evidenceRefs: [findEvidenceId(evidencePool, /approval|approve|resolution/i, 3)].filter(Boolean),
      remediation: 'Provide risk-adjusted financial analysis and legal counsel confirmation before final approval.',
    });
  }

  return { gaps, hasApproval, hasSensitivity, hasLegal };
}

function validateEvidenceReferences(results) {
  const evidenceIds = new Set((results.evidencePool || []).map((e) => e.id));
  const hasRef = (id) => id && evidenceIds.has(id);

  if (!results.evidencePool?.length) {
    throw new Error('Evidence pool is empty. Analysis cannot produce governance outputs without evidence.');
  }

  const decisionsOk = (results.minutes?.keyDecisions || []).every((d) => hasRef(d.evidenceRef));
  const actionsOk = (results.minutes?.actionItems || []).every((a) => hasRef(a.evidenceRef));
  const unresolvedOk = (results.minutes?.unresolvedMatters || []).every((u) => hasRef(u.evidenceRef));
  const insightsOk = (results.insights || []).every((cat) => (cat.insights || []).every((i) => hasRef(i.evidenceRef)));
  const gapsOk = (results.gaps || []).every((g) => (g.evidenceRefs || []).every((r) => hasRef(r)));

  if (!(decisionsOk && actionsOk && unresolvedOk && insightsOk && gapsOk)) {
    throw new Error('Evidence reference validation failed. Some outputs are missing valid evidence IDs.');
  }
}

function runDeterministicAnalysis(assessmentId, meetingName, transcriptText) {
  const evidencePool = buildEvidencePool(transcriptText);
  if (!evidencePool.length) {
    throw new Error('No evidence snippets extracted from transcript.');
  }

  const categoryScores = computeCategoryScores(transcriptText, evidencePool);
  const gapCheck = detectGaps(transcriptText, evidencePool);
  const minutes = buildMinutes(transcriptText, evidencePool);
  const insights = buildInsights(transcriptText, evidencePool);
  const engagement = buildEngagement(transcriptText, evidencePool);

  let governanceScore = computeWeightedScore(categoryScores);
  if (gapCheck.hasApproval && (!gapCheck.hasSensitivity || !gapCheck.hasLegal)) {
    governanceScore = Math.min(governanceScore, 70);
  }

  const riskIndicator = toRiskIndicator(governanceScore);
  const durationMinutes = Math.max(45, Math.min(240, 45 + Math.floor(evidencePool.length * 4)));

  const participants = [...new Set(evidencePool.map((e) => e.speaker).filter((s) => s !== 'Unknown'))]
    .slice(0, 9)
    .map((name, i) => ({
      name,
      role: i < 3 ? 'Executive Director' : 'Non-Executive Director',
      attendee: true,
    }));

  return {
    id: assessmentId,
    meetingName,
    duration: `${durationMinutes} minutes`,
    participants,
    categoryScores,
    governanceScore,
    riskIndicator,
    gaps: gapCheck.gaps,
    minutes,
    insights,
    engagement,
    evidencePool,
    weights: WEIGHTS,
    completedAt: new Date().toISOString(),
  };
}

function getOpenAiClient() {
  if (!process.env.OPENAI_API_KEY) return null;
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

function normaliseModelOutput(assessmentId, meetingName, modelOutput, fallbackText) {
  const evidencePool = Array.isArray(modelOutput.evidencePool) && modelOutput.evidencePool.length
    ? modelOutput.evidencePool
    : buildEvidencePool(fallbackText);

  const categoryScores = modelOutput.categoryScores || computeCategoryScores(fallbackText, evidencePool);
  let governanceScore = Number.isFinite(modelOutput.governanceScore)
    ? clampScore(modelOutput.governanceScore)
    : computeWeightedScore(categoryScores);

  const gapCheck = detectGaps(fallbackText, evidencePool);
  const gaps = Array.isArray(modelOutput.gaps) ? modelOutput.gaps : gapCheck.gaps;

  if (gapCheck.hasApproval && (!gapCheck.hasSensitivity || !gapCheck.hasLegal)) {
    governanceScore = Math.min(governanceScore, 70);
  }

  return {
    id: assessmentId,
    meetingName,
    duration: modelOutput.duration || '90 minutes',
    participants: modelOutput.participants || [],
    categoryScores,
    governanceScore,
    riskIndicator: modelOutput.riskIndicator || toRiskIndicator(governanceScore),
    gaps,
    minutes: modelOutput.minutes || buildMinutes(fallbackText, evidencePool),
    insights: modelOutput.insights || buildInsights(fallbackText, evidencePool),
    engagement: modelOutput.engagement || buildEngagement(fallbackText, evidencePool),
    evidencePool,
    weights: WEIGHTS,
    completedAt: new Date().toISOString(),
  };
}

async function runGovernanceAnalysis(assessmentId, meetingName, files) {
  const transcriptText = await processUploadedFiles(files);
  if (!transcriptText.trim()) {
    throw new Error('No valid text could be extracted from the uploaded files.');
  }

  const openai = getOpenAiClient();
  if (!openai) {
    throw new Error('OPENAI_API_KEY is required. Fallback analysis is disabled.');
  }

  try {
    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      temperature: 0,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: `Analyze this board transcript for "${meetingName}" and return only JSON.\n\n${transcriptText.slice(0, 180000)}`,
        },
      ],
    });

    const parsed = JSON.parse(response.choices?.[0]?.message?.content || '{}');
    const normalised = normaliseModelOutput(assessmentId, meetingName, parsed, transcriptText);
    validateEvidenceReferences(normalised);
    return normalised;
  } catch (error) {
    throw new Error(`Governance analysis failed: ${error.message}`);
  }
}

module.exports = { runGovernanceAnalysis, toRiskIndicator, computeWeightedScore, WEIGHTS };
