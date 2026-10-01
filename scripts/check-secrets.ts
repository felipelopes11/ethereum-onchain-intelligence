/**
 * Fails if tracked files contain likely secrets: private keys, mnemonics, provider
 * API keys or committed .env files. Runs in CI; cheap enough to run before every push.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const RULES: { name: string; pattern: RegExp }[] = [
  // 32-byte hex assigned to something key-like. Plain 32-byte hex is everywhere in a
  // blockchain codebase (hashes), so context is required.
  {
    name: 'private key assignment',
    pattern: /(private[_-]?key|secret|mnemonic)\s*[:=]\s*['"]?(0x)?[0-9a-fA-F]{64}\b/i,
  },
  { name: 'PEM private key', pattern: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  {
    name: 'Alchemy/Infura style key in URL',
    pattern: /(alchemy\.com\/v2|infura\.io\/v3)\/[A-Za-z0-9_-]{20,}/,
  },
  { name: 'Etherscan API key', pattern: /ETHERSCAN_API_KEY\s*=\s*[A-Z0-9]{30,}/ },
  {
    name: 'mnemonic phrase',
    pattern: /\b(mnemonic|seed phrase)\b\s*[:=]\s*['"]?([a-z]+\s+){11,23}[a-z]+/i,
  },
  { name: 'GitHub token', pattern: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
];

const ALLOWED_ENV_FILES = new Set(['.env.example']);

const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
  encoding: 'utf8',
})
  .split('\n')
  .filter(Boolean)
  .filter((f) => !f.startsWith('contracts/lib/') && !f.endsWith('package-lock.json'));

const findings: string[] = [];
for (const file of files) {
  const base = file.split('/').pop() ?? file;
  if (base.startsWith('.env') && !ALLOWED_ENV_FILES.has(base)) {
    findings.push(`${file}: environment file must not be committed`);
    continue;
  }
  let content: string;
  try {
    content = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  content.split('\n').forEach((line, i) => {
    // Intentional fixtures (e.g. redaction tests) opt out explicitly and visibly in review.
    if (line.includes('secret-scan:allow')) return;
    for (const rule of RULES) {
      if (rule.pattern.test(line)) findings.push(`${file}:${i + 1}: possible ${rule.name}`);
    }
  });
}

if (findings.length > 0) {
  console.error(`Potential secrets found:\n  ${findings.join('\n  ')}`);
  process.exit(1);
}
console.log(`No secrets found in ${files.length} files.`);
