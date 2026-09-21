// Reproduce the documented fixture and test a candidate correction in memory.
// This example is separate from GiviLoop; it never executes reviewer output.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const file = new URL("sum.ts", import.meta.url);
const source = readFileSync(file, "utf8");
const missingInitialValue = "values.reduce((total, value) => total + value)";
assert.ok(source.includes(missingInitialValue), "The example changed; reassess this reproduction.");
const corrected = source.replace(missingInitialValue, "values.reduce((total, value) => total + value, 0)");

// Strip only this tiny fixture's TypeScript annotations; requires no runtime dependency.
function loadFixture(text) {
  return new Function(text.replace("export function", "function")
    .replaceAll(": number[]", "").replaceAll(": number", "") + "; return sum;")();
}
assert.throws(() => loadFixture(source)([]), TypeError);
console.log("CONFIRMED: original sum([]) throws TypeError; contract requires 0.");
console.log("Candidate correction: values.reduce((total, value) => total + value, 0)");
const sum = loadFixture(corrected);
for (const [input, expected] of [[[], 0], [[5], 5], [[1, 2, 3], 6], [[-2, 3, -1], 0]]) {
  assert.equal(sum(input), expected);
  console.log(`PASS: sum(${JSON.stringify(input)}) === ${expected}`);
}
assert.equal(readFileSync(file, "utf8"), source);
console.log("4 regression cases passed. The source file was not changed.");
