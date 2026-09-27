// Authored public fixtures and independent acceptance checks. No production code
// or private source is copied into the benchmark workspaces.
export const TASKS = [
  {
    id: 'allocation', file: 'allocation.mjs',
    source: 'export function allocate(total, weights) { throw new Error("Not implemented"); }\n',
    starterTest: "import assert from 'node:assert/strict';\nimport {allocate} from './allocation.mjs';\nassert.deepEqual(allocate(0,[1,2]),[0,0]);\n",
    request: 'Implement allocate(total, weights) in allocation.mjs. Valid inputs: total is an integer 0..1000000; weights is a nonempty array of 1..100 integer weights, each 0..1000000. Return nonnegative integer shares summing exactly to total, without mutating inputs. Use proportional allocation: floor each exact weighted share, then distribute remaining units in descending order of fractional remainders, breaking ties by lower original index. Zero weights receive zero when at least one weight is positive. If every weight is zero, treat all weights as equal. Add regression tests for ordinary and edge cases and run them with node --test. No input validation outside the declared domain is required.',
    async grade(module) {
      let cases = 0;
      const assert = (await import('node:assert/strict')).default;
      for (const [total, weights, expected] of [[0,[1,2],[0,0]],[100,[1,1,1],[34,33,33]],[5,[0,1,0,1],[0,3,0,2]],[5,[0,0,0],[2,2,1]],[2,[1,2,3],[0,1,1]],[7,[1],[7]],[1000000,[1000000,999999],[500000,500000]]]) {
        const original = [...weights]; assert.deepEqual(module.allocate(total, weights), expected); assert.deepEqual(weights, original); cases++;
      }
      // Exact integer reference avoids floating-point tie decisions in the grader.
      for (let n = 1; n <= 20; n++) {
        const weights = Array.from({length:n}, (_,i) => (i*17+n*3)%11), total = n*137+7;
        const denominator = weights.reduce((a,b)=>a+b,0), effective = denominator ? weights : weights.map(()=>1);
        const den = BigInt(denominator || n), products = effective.map(w=>BigInt(total)*BigInt(w));
        const expected = products.map(p=>Number(p/den));
        const order = products.map((p,i)=>({i,r:p%den})).sort((a,b)=>a.r===b.r?a.i-b.i:a.r>b.r?-1:1);
        const left = total-expected.reduce((a,b)=>a+b,0);
        for(let i=0;i<left;i++) expected[order[i].i]++;
        assert.deepEqual(module.allocate(total,weights),expected); cases++;
      }
      return {passed:true,cases};
    },
  },
  {
    id: 'ttl-cache', file: 'cache.mjs',
    source: 'export function createCache({capacity, ttlMs, now}) { throw new Error("Not implemented"); }\n',
    starterTest: "import assert from 'node:assert/strict';\nimport {createCache} from './cache.mjs';\nconst c=createCache({capacity:2,ttlMs:10,now:()=>0});\nc.set('a',1);assert.equal(c.get('a'),1);\n",
    request: 'Implement createCache({capacity, ttlMs, now}) in cache.mjs. Valid inputs: capacity is an integer 1..100, ttlMs is a nonnegative integer, and now() supplies a monotonic integer time. Expose set(key,value), get(key), has(key), delete(key), and size(). Keys are strings and any value including undefined is allowed. An entry expires when now() >= its set time + ttlMs. set resets expiry and makes the key most recently used. A successful get makes a live key most recently used but does not extend its TTL. has does not change recency. Purge expired entries before capacity eviction; evict the least recently used live entry when necessary. get returns undefined for a miss, has distinguishes a stored undefined from a miss, delete returns whether a live key existed, and size counts only live entries. No timers or background work. Add regression tests and run node --test; preserve these contracts rather than adding out-of-domain validation.',
    async grade(module) {
      const assert = (await import('node:assert/strict')).default; let cases=0, t=0;
      const fresh=(capacity=2,ttlMs=10)=>module.createCache({capacity,ttlMs,now:()=>t});
      let c=fresh();c.set('a',undefined);assert.equal(c.has('a'),true);assert.equal(c.get('a'),undefined);assert.equal(c.has('missing'),false);cases++;
      t=10;assert.equal(c.has('a'),false);assert.equal(c.size(),0);assert.equal(c.delete('a'),false);cases++;
      t=0;c=fresh();c.set('a',1);t=5;c.set('b',2);t=9;assert.equal(c.get('a'),1);t=10;assert.equal(c.get('a'),undefined);assert.equal(c.get('b'),2);cases++;
      t=0;c=fresh();c.set('a',1);c.set('b',2);c.get('a');c.set('c',3);assert.equal(c.has('b'),false);assert.equal(c.get('a'),1);assert.equal(c.size(),2);cases++;
      c=fresh();c.set('a',1);c.set('b',2);c.has('a');c.set('c',3);assert.equal(c.has('a'),false);assert.equal(c.has('b'),true);cases++;
      t=0;c=fresh();c.set('a',1);t=5;c.set('b',2);c.get('a');t=10;c.set('c',3);assert.equal(c.has('b'),true);assert.equal(c.has('c'),true);assert.equal(c.size(),2);cases++;
      t=0;c=fresh();c.set('a',1);t=9;c.set('a',2);t=10;assert.equal(c.get('a'),2);t=19;assert.equal(c.has('a'),false);cases++;
      t=0;c=fresh(1);c.set('a',1);c.set('a',2);assert.equal(c.size(),1);assert.equal(c.get('a'),2);c.set('b',3);assert.equal(c.has('a'),false);assert.equal(c.delete('b'),true);assert.equal(c.delete('b'),false);cases++;
      t=0;c=fresh(2,0);c.set('a',1);assert.equal(c.size(),0);assert.equal(c.has('a'),false);cases++;
      t=0;c=fresh();c.set('__proto__',1);c.set('constructor',2);assert.equal(c.get('__proto__'),1);assert.equal(c.get('constructor'),2);assert.equal(c.size(),2);cases++;
      return {passed:true,cases};
    },
  },
];
