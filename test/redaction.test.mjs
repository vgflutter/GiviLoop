import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { distDir } from "./helpers.mjs";

const { redactSecrets } = await import(pathToFileURL(path.join(distDir, "redaction.js")));

test("redaction preserves lock UUID generation and token comparisons exactly", () => {
  const source = `const token = randomUUID();
if (JSON.parse(readFileSync(file, "utf8")).token === token) rmSync(file);
const secret = process.env.SECRET;
let password = readPassword();
const config = { token: currentToken, password: undefined };
if (token == "expected" || token === "other" || token != "previous") return;
// Compare token === token; do not replace token = randomUUID().
interface Credentials { token: string; password: string }
`;
  assert.equal(redactSecrets(source), source);
});

test("quoted secret assignments preserve syntax while masking complete literals", () => {
  const source = `const password = "ab";
const token = 'literal-token';
const secret = "escaped\\\"secret\\\\value";
const template = { apiKey: \`template-secret\` };
const empty = { password: "" };
{"apiKey": "plain-json-secret", "refresh_token": "refresh-value", "clientSecret": "client-value"}
`;
  assert.equal(redactSecrets(source), `const password = "[REDACTED]";
const token = '[REDACTED]';
const secret = "[REDACTED]";
const template = { apiKey: \`[REDACTED]\` };
const empty = { password: "" };
{"apiKey": "[REDACTED]", "refresh_token": "[REDACTED]", "clientSecret": "[REDACTED]"}
`);
});

test("environment values and diff lines are masked without losing structure", () => {
  const source = "PASSWORD=hunter2 # local value\r\nexport TOKEN=baresecret\n+API_KEY=abc-123\n-SECRET=old-value\nDATABASE_URL=postgres://user:pass@localhost/db\nREDIS_URL=redis://localhost:6379\n";
  assert.equal(redactSecrets(source), "PASSWORD=[REDACTED] # local value\r\nexport TOKEN=[REDACTED]\n+API_KEY=[REDACTED]\n-SECRET=[REDACTED]\nDATABASE_URL=[REDACTED]\nREDIS_URL=[REDACTED]\n");
});

test("runtime expressions and ambiguous unquoted identifiers remain code", () => {
  const source = "token = otherToken\nTOKEN = randomUUID()\nTOKEN = source.value\nTOKEN = process.env.TOKEN\nTOKEN = false\nTOKEN=${EXISTING_TOKEN}\nTOKEN = value;\nTOKEN === otherToken\nTOKEN == otherToken\npassword: currentPassword\n// TOKEN = generated()\n";
  assert.equal(redactSecrets(source), source);
  assert.equal(redactSecrets("TOKEN = otherToken\n", "source.ts"), "TOKEN = otherToken\n");
});

test("configuration paths protect lower-case raw scalars without treating code as configuration", () => {
  const source = "token=lowercase-env-secret\npassword: yaml-scalar\n  secret: a password with spaces # keep comment\napi_key = raw-toml-secret\nGITHUB_TOKEN=unprefixed-provider-credential\nservicePassword: password-value\n";
  const expected = "token=[REDACTED]\npassword: [REDACTED]\n  secret: [REDACTED] # keep comment\napi_key = [REDACTED]\nGITHUB_TOKEN=[REDACTED]\nservicePassword: [REDACTED]\n";
  for (const filename of [".env", ".env.local", "project.env", "settings.yaml", "settings.yml", "settings.toml", "settings.ini", "settings.cfg", "settings.conf", "settings.properties", "secrets.txt"]) {
    assert.equal(redactSecrets(source, path.join("/fixture", filename)), expected, filename);
  }
  assert.equal(redactSecrets("token = otherToken\npassword: currentPassword\n", "source.ts"), "token = otherToken\npassword: currentPassword\n");
  const template = "const token = `${getToken()}`;\n";
  assert.equal(redactSecrets(template, "source.js"), template);
});

test("configuration redaction preserves diff prefixes, quoted values and CRLF", () => {
  const source = "+token=secret-one # old comment\r\n-password: another-secret\r\n  'apiKey': 'quoted-secret'\r\ntoken=${EXISTING_TOKEN}\r\n";
  const result = redactSecrets(source, "config.yaml");
  assert.equal(result, "+token=[REDACTED] # old comment\r\n-password: [REDACTED]\r\n  'apiKey': '[REDACTED]'\r\ntoken=${EXISTING_TOKEN}\r\n");
  assert.equal(redactSecrets(result, "config.yaml"), result);
});

test("bearer headers, URL credentials and credential query parameters are masked", () => {
  const source = 'Authorization: Bearer bearer-secret-value\n{"Authorization": "Bearer json-secret"}\nconst endpoint = "https://user:p%40ss@host.test/path?token=url-secret&ok=1";\n';
  assert.equal(redactSecrets(source), 'Authorization: Bearer [REDACTED]\n{"Authorization": "Bearer [REDACTED]"}\nconst endpoint = "https://[REDACTED]@host.test/path?token=[REDACTED]&ok=1";\n');
});

test("known provider credentials and private keys stay protected independently of key names", () => {
  const secrets = ["AKIA1234567890ABCDEF", "ASIA1234567890ABCDEF", "ghp_" + "x".repeat(32), "github_pat_" + "y".repeat(40), "npm_" + "z".repeat(36), "sk-" + "a".repeat(32), "-----BEGIN RSA PRIVATE KEY-----\nfixture-private-material\n-----END RSA PRIVATE KEY-----"];
  const source = secrets.join("\n");
  const result = redactSecrets(source);
  for (const secret of secrets) assert.equal(result.includes(secret), false);
  assert.equal(result.includes("fixture-private-material"), false);
  assert.equal(redactSecrets(result), result);
});

test("masking is idempotent and does not match longer innocent field names", () => {
  const source = 'const tokenCount = "123"; const tokenizer = "test"; const password = "secret";\nTOKEN=secret\n';
  const result = redactSecrets(source);
  assert.equal(result, 'const tokenCount = "123"; const tokenizer = "test"; const password = "[REDACTED]";\nTOKEN=[REDACTED]\n');
  assert.equal(redactSecrets(result), result);
});
