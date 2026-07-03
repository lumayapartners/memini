interface SecretPattern {
  label: string;
  regex: RegExp;
}

// Order matters: more specific patterns first so labels are accurate.
const PATTERNS: SecretPattern[] = [
  { label: 'aws-access-key', regex: /\b(A3T[A-Z0-9]|AKIA|ASIA|ABIA|ACCA)[A-Z0-9]{16}\b/g },
  { label: 'github-token', regex: /\bgh[pousr]_[A-Za-z0-9]{36,251}\b/g },
  { label: 'anthropic-key', regex: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g },
  { label: 'openai-key', regex: /\bsk-(proj-)?[A-Za-z0-9_-]{20,}\b/g },
  { label: 'stripe-key', regex: /\b[rs]k_(live|test)_[A-Za-z0-9]{20,}\b/g },
  { label: 'slack-token', regex: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { label: 'google-api-key', regex: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { label: 'jwt', regex: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\b/g },
  { label: 'private-key', regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  {
    label: 'connection-string',
    regex: /\b(postgres(ql)?|mysql|mongodb(\+srv)?|redis|amqp):\/\/[^\s:@]+:[^\s@]+@[^\s]+/gi,
  },
  { label: 'npm-token', regex: /\bnpm_[A-Za-z0-9]{36,}\b/g },
  {
    label: 'url-credentials',
    regex: /\bhttps?:\/\/[^\s:@/]+:[^\s@/]+@[^\s]+/gi,
  },
  {
    label: 'password-assignment',
    regex: /\b(password|passwd|pwd|secret|api[_-]?key|token)\s*[:=]\s*['"]?[^\s'"]{8,}['"]?/gi,
  },
];

export interface RedactionResult {
  text: string;
  redactions: string[];
}

export function redactSecrets(input: string): RedactionResult {
  let text = input;
  const redactions: string[] = [];
  for (const { label, regex } of PATTERNS) {
    text = text.replace(regex, () => {
      redactions.push(label);
      return `[REDACTED:${label}]`;
    });
  }
  return { text, redactions };
}
