import path from "node:path";

const SECRET_SUFFIX = "(?:api[_-]?key|token|secret|password|passwd|pwd|(?:DATABASE|REDIS|POSTGRES|MYSQL)_URL)";
const SECRET_NAME = `(?:[A-Za-z_$][\\w$-]*)?${SECRET_SUFFIX}`;
const ENVIRONMENT_NAME = `(?:[A-Z_][A-Z0-9_]*)?${SECRET_SUFFIX.toUpperCase()}`;

/**
 * Mask recognizable credential literals without rewriting executable expressions.
 * This is a best-effort text filter, not a secret scanner or a language parser.
 * Ambiguous unquoted identifiers (token = otherToken) remain code; raw uppercase
 * environment assignments are treated as configuration. A configuration source
 * path also enables lower-case raw scalars. Unknown credential names and values
 * split across expressions or encoded in other formats still need review.
 */
export function redactSecrets(value: string, sourcePath?: string): string {
  // Require a single assignment/colon followed by a complete string literal.
  // In particular, neither randomUUID() nor === is a credential literal.
  const literal = new RegExp(
    `(?<![\\w$])(["']?${SECRET_NAME}["']?[ \\t]*(?::|=(?!=|>))[ \\t]*)(["'\x60])((?:\\\\[\\s\\S]|(?!\\2)[^\\\\])*)\\2`,
    "gi",
  );
  let result = value.replace(literal, (match, prefix: string, quote: string, content: string) => {
    if (content.length === 0 || (quote === "`" && /^(?:\$\{[^{}]+\})+$/.test(content))) return match;
    return `${prefix}${quote}[REDACTED]${quote}`;
  });

  const basename = path.basename(sourcePath ?? "").toLowerCase();
  const configuration = /\.(?:ya?ml|toml|ini|cfg|conf|properties|txt)$/.test(basename) ||
    basename === ".env" || basename.startsWith(".env.") || basename.endsWith(".env");
  if (configuration) {
    const scalar = new RegExp(
      `^([ \\t]*(?:[+-][ \\t]*)?(?:export[ \\t]+)?["']?${SECRET_NAME}["']?[ \\t]*(?::|=(?!=|>))[ \\t]*)([^\\r\\n]*)(\\r?)$`,
      "gmi",
    );
    result = result.replace(scalar, (match, prefix: string, raw: string, ending: string) => {
      const parts = /^(.*?)([ \t]+[#;].*)?([ \t]*)$/.exec(raw);
      if (!parts) return match;
      const content = parts[1];
      if (!content || /^["'`#;]/.test(content) || content === "[REDACTED]" ||
          /^\$\{[A-Za-z_][\w]*\}$/.test(content)) return match;
      return `${prefix}[REDACTED]${parts[2] ?? ""}${parts[3]}${ending}`;
    });
  }

  // Dotenv-style uppercase keys are unambiguous enough to mask bare values.
  // Preserve diff prefixes, indentation, comments, line endings and expressions.
  const environment = new RegExp(
    `^([ \\t]*(?:[+-][ \\t]*)?(?:export[ \\t]+)?${ENVIRONMENT_NAME}[ \\t]*=(?!=|>)[ \\t]*)([^\\r\\n]*)(\\r?)$`,
    "gm",
  );
  if (!sourcePath || configuration) result = result.replace(environment, (match, prefix: string, raw: string, ending: string) => {
    const parts = /^([^\s#;'"`]+)([ \t]*(?:#.*)?)$/.exec(raw);
    if (!parts) return match;
    const atom = parts[1];
    if (/[(){}\[\]<>?$]/.test(atom) || /^(?:true|false|null|undefined)$/.test(atom) ||
        /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+$/.test(atom)) return match;
    return `${prefix}[REDACTED]${parts[2]}${ending}`;
  });

  return result
    .replace(/(authorization["']?\s*:\s*["']?bearer\s+)[^\s"'`,;}]+/gi, "$1[REDACTED]")
    .replace(/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, "[REDACTED_AWS_ACCESS_KEY_ID]")
    .replace(/\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g, "gh[REDACTED]")
    .replace(/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, "github_pat_[REDACTED]")
    .replace(/\bnpm_[A-Za-z0-9]{36,}\b/g, "npm_[REDACTED]")
    .replace(/sk-[A-Za-z0-9_-]{20,}/g, "sk-[REDACTED]")
    .replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/:'"`<>@]+:[^\s/'"`<>@]+@/gi, "$1[REDACTED]@")
    .replace(new RegExp(`([?&]${SECRET_NAME}=)[^&#\\s"'\x60]+`, "gi"), "$1[REDACTED]")
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[REDACTED PRIVATE KEY]");
}
