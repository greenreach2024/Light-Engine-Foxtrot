export const GRANT_PROGRAM_QUESTION_MAPS = {
  'AAFC-ACT-RD': [
    {
      fieldKey: 'project_title',
      question: 'What is the title of your clean technology project?',
      questionType: 'text',
      helpText: 'Use a concise title that clearly identifies the technology and use case.',
      required: true
    },
    {
      fieldKey: 'project_objectives',
      question: 'Describe your project objectives and how they contribute to reducing agricultural GHG emissions.',
      questionType: 'textarea',
      helpText: 'Include measurable outcomes and expected environmental impact.',
      required: true,
      aiAssist: true
    },
    {
      fieldKey: 'trl_level',
      question: 'What is your current Technology Readiness Level (TRL)?',
      questionType: 'select',
      options: ['TRL 1-3', 'TRL 4-5', 'TRL 6-7', 'TRL 8-9'],
      required: true
    },
    {
      fieldKey: 'cost_share_plan',
      question: 'How will you finance your matching contribution?',
      questionType: 'textarea',
      required: true,
      aiAssist: true
    }
  ],
  'BIO-SGAP': [
    {
      fieldKey: 'sustainability_baseline',
      question: 'What is your current sustainability baseline and target improvement?',
      questionType: 'textarea',
      required: true,
      aiAssist: true
    },
    {
      fieldKey: 'adoption_plan',
      question: 'What clean technology or process will you adopt and why?',
      questionType: 'textarea',
      required: true,
      aiAssist: true
    },
    {
      fieldKey: 'project_budget_match',
      question: 'How will your organization provide its cost-share contribution?',
      questionType: 'textarea',
      required: true
    },
    {
      fieldKey: 'implementation_timeline',
      question: 'Provide your implementation timeline and key milestones.',
      questionType: 'textarea',
      required: true
    }
  ],
  'CFIN-OFTP': [
    {
      fieldKey: 'pilot_problem',
      question: 'What specific food technology challenge does your pilot address?',
      questionType: 'textarea',
      required: true,
      aiAssist: true
    },
    {
      fieldKey: 'pilot_partner',
      question: 'Who is your pilot partner and what is their role?',
      questionType: 'text',
      required: true
    },
    {
      fieldKey: 'pilot_outcomes',
      question: 'What outcomes and validation metrics will you deliver during the pilot?',
      questionType: 'textarea',
      required: true
    },
    {
      fieldKey: 'ip_and_scale',
      question: 'How will your IP and commercialization strategy support scale after the pilot?',
      questionType: 'textarea',
      required: true
    }
  ],
  'CFIN-ISF': [
    {
      fieldKey: 'industry_challenge_fit',
      question: 'How does your solution address the sponsor challenge statement?',
      questionType: 'textarea',
      required: true,
      aiAssist: true
    },
    {
      fieldKey: 'trl_evidence',
      question: 'Provide evidence that your technology is at TRL 3 or higher.',
      questionType: 'textarea',
      required: true
    },
    {
      fieldKey: 'pilot_execution',
      question: 'What is your 12-month pilot execution plan?',
      questionType: 'textarea',
      required: true
    },
    {
      fieldKey: 'commercial_path',
      question: 'What is your post-pilot commercialization pathway?',
      questionType: 'textarea',
      required: true
    }
  ],
  'NRC-IRAP': [
    {
      fieldKey: 'innovation_description',
      question: 'Describe the innovation and technical uncertainty your project addresses.',
      questionType: 'textarea',
      required: true,
      aiAssist: true
    },
    {
      fieldKey: 'rd_workplan',
      question: 'Provide your R&D workplan, milestones, and resource requirements.',
      questionType: 'textarea',
      required: true
    },
    {
      fieldKey: 'market_potential',
      question: 'What is the commercial potential and target market opportunity?',
      questionType: 'textarea',
      required: true
    },
    {
      fieldKey: 'team_capacity',
      question: 'Why is your team positioned to deliver this innovation?',
      questionType: 'textarea',
      required: true
    }
  ],
  'CSBFP-LOAN': [
    {
      fieldKey: 'financing_need',
      question: 'What business investment are you financing and why?',
      questionType: 'textarea',
      required: true
    },
    {
      fieldKey: 'loan_amount',
      question: 'What loan amount are you requesting?',
      questionType: 'number',
      required: true
    },
    {
      fieldKey: 'repayment_plan',
      question: 'Describe your repayment plan and projected cash flow support.',
      questionType: 'textarea',
      required: true
    },
    {
      fieldKey: 'collateral',
      question: 'What assets or guarantees support this financing request?',
      questionType: 'textarea',
      required: true
    }
  ],
  'AAFC-AGRIINNOVATE': [
    {
      fieldKey: 'commercialization_readiness',
      question: 'What evidence shows your innovation is ready for commercialization support?',
      questionType: 'textarea',
      required: true,
      aiAssist: true
    },
    {
      fieldKey: 'market_adoption',
      question: 'Who are your initial adopters and what is your market adoption strategy?',
      questionType: 'textarea',
      required: true
    },
    {
      fieldKey: 'project_risks',
      question: 'What are your top commercialization risks and mitigations?',
      questionType: 'textarea',
      required: true
    },
    {
      fieldKey: 'repayment_capacity',
      question: 'How will your business support repayable contribution obligations?',
      questionType: 'textarea',
      required: true
    }
  ],
  'ON-GROW-MARKET': [
    {
      fieldKey: 'market_objective',
      question: 'What Ontario market development objective will this project achieve?',
      questionType: 'textarea',
      required: true
    },
    {
      fieldKey: 'target_buyers',
      question: 'Who are your target buyers or channels?',
      questionType: 'textarea',
      required: true
    },
    {
      fieldKey: 'promotion_activities',
      question: 'What promotional or market activities will you deliver?',
      questionType: 'textarea',
      required: true
    },
    {
      fieldKey: 'market_results',
      question: 'What measurable market outcomes do you expect?',
      questionType: 'textarea',
      required: true
    }
  ]
};

export const GRANT_PROGRAM_BUDGET_CATEGORIES = {
  'AAFC-ACT-RD': [
    { category: 'Personnel', description: 'Project staff salaries and benefits', typical_percent: '30-50%', eligible: true },
    { category: 'Equipment', description: 'Eligible equipment and instrumentation', typical_percent: '20-40%', eligible: true },
    { category: 'Materials', description: 'Consumables and project supplies', typical_percent: '5-15%', eligible: true },
    { category: 'Professional Services', description: 'Technical consultants and testing services', typical_percent: '5-15%', eligible: true },
    { category: 'Travel', description: 'Project-required travel', typical_percent: '2-8%', eligible: true }
  ],
  'BIO-SGAP': [
    { category: 'Equipment', description: 'Clean technology equipment adoption', typical_percent: '25-45%', eligible: true },
    { category: 'Implementation Labour', description: 'Installation and implementation labour', typical_percent: '20-35%', eligible: true },
    { category: 'Professional Services', description: 'Engineering, sustainability, and integration support', typical_percent: '10-20%', eligible: true },
    { category: 'Training', description: 'Staff onboarding and process adoption', typical_percent: '5-12%', eligible: true }
  ],
  'CFIN-OFTP': [
    { category: 'Pilot Setup', description: 'Pilot environment setup and tooling', typical_percent: '20-35%', eligible: true },
    { category: 'Validation & Testing', description: 'Product/process testing costs', typical_percent: '20-30%', eligible: true },
    { category: 'Personnel', description: 'Pilot execution labour', typical_percent: '20-35%', eligible: true },
    { category: 'External Services', description: 'Specialist technical support', typical_percent: '10-20%', eligible: true }
  ],
  'CFIN-ISF': [
    { category: 'Pilot Development', description: 'Prototype/pilot solution development', typical_percent: '25-40%', eligible: true },
    { category: 'Pilot Operations', description: 'Pilot run and operational costs', typical_percent: '20-35%', eligible: true },
    { category: 'Technical Services', description: 'Testing, validation, and specialist support', typical_percent: '10-25%', eligible: true },
    { category: 'Commercial Readiness', description: 'Post-pilot commercialization preparation', typical_percent: '10-20%', eligible: true }
  ]
};