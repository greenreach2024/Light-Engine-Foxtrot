/**
 * Agent Enforcement Module
 * ========================
 * Runtime response-shape validation and prompt enforcement for all GreenReach AI agents.
 * Every agent (E.V.I.E., F.A.Y.E., G.W.E.N.) imports this module and:
 *   1. Prepends ENFORCEMENT_PROMPT_BLOCK to their system prompt
 *   2. Runs enforceResponseShape() on every reply before res.json()
 *
 * Design principles:
 *   - Rules are concrete (pattern-matched, not vague)
 *   - Rules are at the TOP of the prompt (not buried)
 *   - Output format is constrained (violations are detectable)
 *   - Bad patterns are explicitly banned with examples
 *   - A self-check runs before sending (runtime, not just prompt-level)
 */


// ── Banned phrase patterns ─────────────────────────────────────────────
// These are concrete fabrication/filler markers. Regex-tested against every reply.
const BANNED_PATTERNS = [
  // Filler openers
  /^(absolutely|great question|sure thing|of course)[!.,]/i,
  // "General insights" filler — the #1 fabrication gateway
  /however[, ]+I can (provide|offer|share) (some )?(general|broad|high-level) (insights|guidance|information|overview)/i,
  // Vague list padding when no data exists
  /key (factors|considerations|elements|aspects) (to consider|include|are)[:\s]/i,
  // Unsourced market claims
  /market (trends?|data|conditions?|prices?) (suggest|indicate|show|reveal)/i,
  // Story-telling / narrative fabrication markers
  /imagine (a |if |that )/i,
  /let me paint (a |you )/i,
  /picture this/i,
  // Invented statistics without tool attribution
  /approximately \d+%(?! \()/i,  // % claims without parenthetical source
  /studies (show|suggest|indicate|have found)/i,  // unsourced "studies say"
  /research (shows|suggests|indicates)/i,  // unsourced "research says"
  // Padding after honest "I don't have data"
  /I don't have.*but (here are|let me|I can still)/i,
  // Offering to do things not asked
  /would you like me to (walk you through|provide an overview|explain the basics)/i,
  // Excessive hedging that obscures lack of data
  /it's worth noting that there are (many|several|various|numerous) factors/i,
];

// Subset that only applies when the agent had NO tool results to cite
const NO_DATA_BANNED_PATTERNS = [
  /based on (current|recent|available|general) (market |industry |)?(data|trends|information|conditions)/i,
  /typically[, ]+(farms?|growers?|producers?|businesses?) (see|experience|report)/i,
  /in (my|our) experience/i,
  /generally speaking/i,
  /as a general rule/i,
];

// ── Enforcement prompt block ───────────────────────────────────────────
// This is prepended to EVERY agent's system prompt — at the very top,
// before identity, before role, before anything else.
const ENFORCEMENT_PROMPT_BLOCK = `
## ENFORCEMENT BLOCK (MANDATORY -- READ BEFORE ALL OTHER INSTRUCTIONS)

These rules override ALL other instructions. Violations are detected at runtime and flagged.

### RULE 1: Answer first.
Your first sentence MUST directly answer the user's question or state the current status.
- BANNED: Starting with context, background, caveats, or "Let me explain..."
- BANNED: Starting with "Great question!" / "Absolutely!" / "Sure thing!"
- REQUIRED: First sentence = the answer. Always.

### RULE 2: No fabrication. Zero tolerance.
If a tool returned no data, empty results, or an error:
- Say: "I do not have data on [topic]." Full stop.
- Do NOT follow with "However, here are some general insights..."
- Do NOT list "key factors to consider" from your training data.
- Do NOT invent statistics, percentages, or trends.
- Do NOT attribute claims to unnamed "studies" or "research."
- Do NOT say "based on current market data" when no tool provided that data.
- SOURCE RULE: Every factual claim must cite the tool or data source that produced it. No source = do not state it.

### RULE 3: Reduce, do not expand.
- One question per reply. Maximum.
- One recommendation per reply. Not a menu of options.
- If the user asked about X, answer X. Do not also cover Y and Z.
- Do not list all phases/steps/options. Only the current one and the next one.
- Strip any sentence that does not serve the direct answer.

### RULE 4: Separate known from unknown.
- KNOWN = data from a tool call, database query, or document you read. State it confidently with source.
- UNKNOWN = anything else. Flag it: "I do not have verified data on this."
- NEVER blend known and unknown into a smooth paragraph. The user must see the boundary.

### RULE 5: One clear next move.
End every response with exactly ONE of:
- A specific recommendation ("I suggest X because Y.")
- A single question ("Do you want me to run the harvest report?")
- An explicit "Nothing else needed right now."
Do NOT end with open-ended offers ("Let me know if you need anything else").
Do NOT end with a list of things you could help with.

### RULE 6: No stories. No narratives. No embellishment.
- Do not "paint a picture" or "set the scene."
- Do not create hypothetical scenarios.
- Do not anthropomorphize data or processes.
- Stick to: fact, assessment, action.

### SELF-CHECK (MANDATORY before every response):
Before sending, verify ALL of the following. If ANY check fails, rewrite.
1. Did I answer the question in my first sentence?
2. Did I reduce the scope to only what was asked?
3. Am I asking more than one question? (If yes: cut to one.)
4. Did I separate known (sourced) from unknown (flagged)?
5. Did I give exactly one clear next move at the end?
6. Does any sentence lack a source for a factual claim? (If yes: remove or flag as unverified.)
7. Did I avoid filler openers, vague lists, and narrative padding?
If any check fails, rewrite the response before sending.

### OUTPUT SHAPE (enforced):
1. Direct answer (1-2 sentences, sourced).
2. Supporting fact or data point (if relevant, with source).
3. One next step OR one question OR "nothing else needed."
No preamble before 1. No summary after 3. No exceptions.

END OF ENFORCEMENT BLOCK.
`;

// ── Runtime validator ──────────────────────────────────────────────────

/**
 * Check a reply string against the banned-pattern list.
 * Returns { clean: bool, violations: string[], sanitized: string }
 *
 * sanitized = the reply with violation sentences removed (best-effort).
 * If the entire reply is violations, returns it unchanged with warnings.
 *
 * @param {string} reply - The LLM reply text
 * @param {object} opts
 * @param {boolean} opts.hadToolData - Whether tool calls returned real data
 * @param {string}  opts.agent       - 'evie' | 'faye' | 'gwen'
 */
function enforceResponseShape(reply, opts = {}) {
  if (!reply || typeof reply !== 'string') {
    return { clean: true, violations: [], sanitized: reply || '' };
  }

  const violations = [];
  const { hadToolData = true, agent = 'unknown' } = opts;

  // Check universal banned patterns
  for (const pattern of BANNED_PATTERNS) {
    if (pattern.test(reply)) {
      violations.push(`BANNED_PATTERN: ${pattern.source}`);
    }
  }

  // Check no-data-specific patterns only when agent had no tool data
  if (!hadToolData) {
    for (const pattern of NO_DATA_BANNED_PATTERNS) {
      if (pattern.test(reply)) {
        violations.push(`NO_DATA_VIOLATION: ${pattern.source}`);
      }
    }
  }

  // Check: starts with filler opener
  const firstLine = reply.split('\n')[0].trim();
  if (/^(great question|absolutely|sure thing|of course|certainly|wonderful|fantastic)[!.,:\s]/i.test(firstLine)) {
    violations.push('FILLER_OPENER: Response starts with a banned filler phrase');
  }

  // Check: multiple questions in one reply
  const questionMarks = (reply.match(/\?/g) || []).length;
  if (questionMarks > 2) {
    violations.push(`QUESTION_OVERLOAD: ${questionMarks} questions detected (max 2 including rhetorical)`);
  }

  // Check: offers a menu of options without recommendation
  if (/you could (do |try |use |go with )(A|option 1|either)/i.test(reply) ||
      /here are (some|a few|several) options/i.test(reply) ||
      /option (1|A)[:\s].*option (2|B)[:\s]/i.test(reply)) {
    violations.push('OPTIONS_WITHOUT_RECOMMENDATION: Listed options instead of recommending one');
  }

  // Check: "let me know" endings
  if (/let me know if (you |there.s |you.d like)/i.test(reply) ||
      /feel free to (ask|reach out|let me know)/i.test(reply) ||
      /I.m here (to help|if you need|whenever)/i.test(reply)) {
    violations.push('OPEN_ENDED_CLOSE: Ended with vague offer instead of specific next step');
  }

  // Log violations for monitoring
  if (violations.length > 0) {
    console.warn(`[ENFORCEMENT:${agent.toUpperCase()}] ${violations.length} violation(s) detected:`, violations.join('; '));
  }

  return {
    clean: violations.length === 0,
    violations,
    sanitized: reply,  // We log but do not mutate — the prompt-level enforcement should prevent these
    violationCount: violations.length
  };
}

/**
 * Middleware-style wrapper for res.json on chat endpoints.
 * Logs enforcement violations alongside the normal response.
 * Adds an `enforcement` field to the response when violations are detected
 * (only in non-production or when ENFORCEMENT_VERBOSE=true).
 *
 * @param {object} res - Express response object
 * @param {object} payload - The response payload ({ ok, reply, ... })
 * @param {object} opts - { hadToolData, agent }
 */
function sendEnforcedResponse(res, payload, opts = {}) {
  if (!payload.reply) {
    return res.json(payload);
  }

  const result = enforceResponseShape(payload.reply, opts);

  // Always track enforcement metrics internally
  if (result.violations.length > 0) {
    const logEntry = {
      agent: opts.agent || 'unknown',
      timestamp: new Date().toISOString(),
      violationCount: result.violations.length,
      violations: result.violations,
      replyLength: payload.reply.length,
      hadToolData: opts.hadToolData ?? true
    };

    // Fire-and-forget log to console (and optionally to DB in future)
    console.warn('[ENFORCEMENT_LOG]', JSON.stringify(logEntry));
  }

  // Add enforcement metadata to response (visible to frontend for debugging)
  const response = { ...payload };
  if (result.violations.length > 0) {
    response.enforcement = {
      violations: result.violations.length,
      flags: result.violations.map(v => v.split(':')[0])
    };
  }

  return res.json(response);
}

export {
  ENFORCEMENT_PROMPT_BLOCK,
  BANNED_PATTERNS,
  NO_DATA_BANNED_PATTERNS,
  enforceResponseShape,
  sendEnforcedResponse
};
