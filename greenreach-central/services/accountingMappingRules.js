const DEV_TOOL_SERVICE_PATTERNS = [
  'codebuild',
  'codepipeline',
  'codecommit',
  'codestar',
  'codeguru',
  'cloud9',
  'xray',
  'cloudwatch synthetics'
];

const PAYMENT_PATTERN = /(stripe|square|paypal|payment|merchant)/i;

export function mapAwsCostToAccountCode({ serviceName = '', usageType = '' } = {}) {
  const service = String(serviceName || '').toLowerCase();
  const usage = String(usageType || '').toLowerCase();

  if (DEV_TOOL_SERVICE_PATTERNS.some((pattern) => service.includes(pattern))) {
    return '620000';
  }

  if (PAYMENT_PATTERN.test(service) || PAYMENT_PATTERN.test(usage)) {
    return '630000';
  }

  return '610000';
}

export function mapAccountCodeReason(accountCode) {
  switch (accountCode) {
    case '620000':
      return 'AWS developer-tooling service';
    case '630000':
      return 'Payment-processing related usage';
    case '610000':
    default:
      return 'Cloud infrastructure default mapping';
  }
}
