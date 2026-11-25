/**
 * lib/random.js — random モジュール（ADR-013）
 *
 * CPython と同じメルセンヌ・ツイスター（MT19937）と、同じ取り出し方（_randbelow・randrange・shuffle・sample・choices）
 * にしてある。そのため random.seed(整数) を使えば、CPython と同じ乱数の列になる（CPython との比較テストで確かめる）。
 * seed() を呼ばなければ、実行ごとに違う種で始める（CPython と同じ）。
 */
import {
  PyError, makeFloat, isInt, isBool, isFloat, isNum, isStr, isTuple, isList, num, normInt, typeName, iterate, PyRange,
} from '../values.js';

const def = (name, fn) => { fn.pyName = name; return fn; };

/** MT19937（CPython の _randommodule.c と同じ） */
class MT19937 {
  constructor() { this.mt = new Uint32Array(624); this.index = 625; }

  initGenrand(s) {
    const mt = this.mt;
    mt[0] = s >>> 0;
    for (let i = 1; i < 624; i++) {
      const prev = mt[i - 1] ^ (mt[i - 1] >>> 30);
      mt[i] = (Math.imul(1812433253, prev) + i) >>> 0;
    }
    this.index = 624;
  }

  /** init_by_array：整数の種を 32 ビットずつ（下位から）区切った配列で初期化する */
  initByArray(key) {
    const mt = this.mt;
    this.initGenrand(19650218);
    let i = 1, j = 0;
    for (let k = Math.max(624, key.length); k > 0; k--) {
      const prev = mt[i - 1] ^ (mt[i - 1] >>> 30);
      mt[i] = ((mt[i] ^ Math.imul(prev, 1664525)) + key[j] + j) >>> 0;
      i++; j++;
      if (i >= 624) { mt[0] = mt[623]; i = 1; }
      if (j >= key.length) j = 0;
    }
    for (let k = 623; k > 0; k--) {
      const prev = mt[i - 1] ^ (mt[i - 1] >>> 30);
      mt[i] = ((mt[i] ^ Math.imul(prev, 1566083941)) - i) >>> 0;
      i++;
      if (i >= 624) { mt[0] = mt[623]; i = 1; }
    }
    mt[0] = 0x80000000;
    this.index = 624;
  }

  /** 32 ビットの乱数 */
  genrand() {
    const mt = this.mt;
    if (this.index >= 624) {
      for (let k = 0; k < 624; k++) {
        const y = (mt[k] & 0x80000000) | (mt[(k + 1) % 624] & 0x7fffffff);
        mt[k] = mt[(k + 397) % 624] ^ (y >>> 1) ^ (y & 1 ? 0x9908b0df : 0);
      }
      this.index = 0;
    }
    let y = mt[this.index++];
    y ^= y >>> 11;
    y = (y ^ ((y << 7) & 0x9d2c5680)) >>> 0;
    y = (y ^ ((y << 15) & 0xefc60000)) >>> 0;
    y ^= y >>> 18;
    return y >>> 0;
  }

  /** [0, 1) の小数（53 ビット。CPython の random_random） */
  random() {
    const a = this.genrand() >>> 5, b = this.genrand() >>> 6;
    return (a * 67108864 + b) / 9007199254740992;
  }

  /** k ビットの乱数（BigInt。CPython の getrandbits） */
  getrandbits(k) {
    if (k <= 32) return BigInt(this.genrand() >>> (32 - k));
    let r = 0n;
    for (let shift = 0n; k > 0; k -= 32, shift += 32n) {
      let w = this.genrand();
      if (k < 32) w >>>= 32 - k;
      r |= BigInt(w) << shift;
    }
    return r;
  }

  /** [0, n) の整数（BigInt。CPython の _randbelow_with_getrandbits） */
  randbelow(n) {
    const k = n.toString(2).length;
    let r = this.getrandbits(k);
    while (r >= n) r = this.getrandbits(k);
    return r;
  }
}

/** 整数の種を、32 ビットずつ区切った配列にする（CPython の random_seed） */
function seedKey(a) {
  let x = a < 0n ? -a : a;
  if (x === 0n) return [0];
  const key = [];
  while (x > 0n) { key.push(Number(x & 0xffffffffn)); x >>= 32n; }
  return key;
}

/** 種を指定しないとき（実行ごとに違う種） */
function freshKey() {
  const words = new Uint32Array(8);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(words);
  else for (let i = 0; i < words.length; i++) words[i] = Math.floor(Math.random() * 2 ** 32);
  return [...words];
}

const toBig = (v, fname, loc) => {
  if (isBool(v)) return BigInt(num(v));
  if (isInt(v)) return BigInt(v);
  throw new PyError('TypeError', `random.${fname}() には整数が必要です（${typeName(v)} が渡されました）`, loc);
};

/** 添字で取り出せる並び（list・tuple・str・range） */
function seqOf(v, fname, loc) {
  if (isList(v) || isTuple(v)) return v;
  if (isStr(v)) return [...v];
  if (v instanceof PyRange) return Array.from({ length: v.length }, (_, i) => v.at(i));
  throw new PyError('TypeError', `random.${fname}() には list・tuple・文字列・range を渡します（${typeName(v)} が渡されました）`, loc);
}

/** random モジュールの属性を作る（実行ごとに作り直す。状態を持つため） */
export function makeRandomModule() {
  const g = new MT19937();
  g.initByArray(freshKey());
  const randbelow = (n) => g.randbelow(n);

  return {
    seed: def('seed', (args, _k, ctx) => {
      const a = args[0] ?? null;
      if (a === null) g.initByArray(freshKey());
      else if (isInt(a) || isBool(a)) g.initByArray(seedKey(toBig(a, 'seed', ctx.loc)));
      else if (isFloat(a) && Number.isInteger(a.v)) g.initByArray(seedKey(BigInt(a.v)));   // CPython は hash(x)。整数の小数は同じ値
      else throw new PyError('TypeError', `random.seed() には整数を渡してください（${typeName(a)} はまだ対応していません）`, ctx.loc);
      return null;
    }),
    random: def('random', () => makeFloat(g.random())),
    uniform: def('uniform', (args, _k, ctx) => {
      const [a, b] = args.map(v => { if (!isNum(v)) throw new PyError('TypeError', `random.uniform() には数が必要です（${typeName(v)} が渡されました）`, ctx.loc); return num(v); });
      return makeFloat(a + (b - a) * g.random());
    }),
    getrandbits: def('getrandbits', (args, _k, ctx) => normInt(g.getrandbits(Number(toBig(args[0], 'getrandbits', ctx.loc))))),
    randrange: def('randrange', (args, _k, ctx) => randrange(args, randbelow, ctx.loc)),
    randint: def('randint', (args, _k, ctx) => {
      if (args.length !== 2) throw new PyError('TypeError', `random.randint() の引数は 2 個ですが、${args.length} 個渡されました`, ctx.loc);
      return randrange([args[0], normInt(toBig(args[1], 'randint', ctx.loc) + 1n)], randbelow, ctx.loc, 'randint');
    }),
    choice: def('choice', (args, _k, ctx) => {
      const seq = seqOf(args[0], 'choice', ctx.loc);
      if (seq.length === 0) throw new PyError('IndexError', '空の並びからは選べません', ctx.loc);
      return seq[Number(randbelow(BigInt(seq.length)))];
    }),
    shuffle: def('shuffle', (args, _k, ctx) => {
      const x = args[0];
      if (!isList(x)) throw new PyError('TypeError', `random.shuffle() にはリストを渡します（${typeName(x)} が渡されました）`, ctx.loc);
      for (let i = x.length - 1; i >= 1; i--) {
        const j = Number(randbelow(BigInt(i + 1)));
        [x[i], x[j]] = [x[j], x[i]];
      }
      return null;
    }),
    sample: def('sample', (args, kwargs, ctx) => {
      const pop = seqOf(args[0], 'sample', ctx.loc);
      const k = Number(toBig(args[1] ?? kwargs.k, 'sample', ctx.loc));
      const n = pop.length;
      if (k < 0 || k > n) throw new PyError('ValueError', '取り出す数が、並びの長さより大きいか負です', ctx.loc);
      const result = new Array(k);
      let setsize = 21;
      if (k > 5) setsize += 4 ** Math.ceil(Math.log(k * 3) / Math.log(4));
      if (n <= setsize) {
        const pool = [...pop];
        for (let i = 0; i < k; i++) {
          const j = Number(randbelow(BigInt(n - i)));
          result[i] = pool[j];
          pool[j] = pool[n - i - 1];
        }
      } else {
        const selected = new Set();
        for (let i = 0; i < k; i++) {
          let j = Number(randbelow(BigInt(n)));
          while (selected.has(j)) j = Number(randbelow(BigInt(n)));
          selected.add(j);
          result[i] = pop[j];
        }
      }
      return result;
    }),
    choices: def('choices', (args, kwargs, ctx) => {
      const pop = seqOf(args[0], 'choices', ctx.loc);
      const n = pop.length;
      const k = kwargs.k !== undefined ? Number(toBig(kwargs.k, 'choices', ctx.loc)) : 1;
      const weights = args[1] ?? kwargs.weights ?? null;
      if (weights === null) return Array.from({ length: k }, () => pop[Math.floor(g.random() * n)]);
      const cum = [];
      let acc = 0;
      for (const w of iterate(weights, ctx.loc)) { acc += num(w); cum.push(acc); }
      if (cum.length !== n) throw new PyError('ValueError', '重みの数が、並びの長さと違います', ctx.loc);
      const total = cum[n - 1];
      if (!(total > 0)) throw new PyError('ValueError', '重みの合計は 0 より大きくなければなりません', ctx.loc);
      return Array.from({ length: k }, () => {
        const x = g.random() * total;
        let lo = 0, hi = n - 1;   // bisect_right(cum, x, 0, n - 1)
        while (lo < hi) { const mid = (lo + hi) >> 1; if (x < cum[mid]) hi = mid; else lo = mid + 1; }
        return pop[lo];
      });
    }),
  };
}

/** randrange(stop) / randrange(start, stop[, step])（CPython と同じ手順） */
function randrange(args, randbelow, loc, fname = 'randrange') {
  const start = toBig(args[0], fname, loc);
  if (args.length === 1 || args[1] === null) {
    if (start > 0n) return normInt(randbelow(start));
    throw new PyError('ValueError', `random.${fname}() の範囲が空です`, loc);
  }
  const stop = toBig(args[1], fname, loc);
  const step = args.length > 2 ? toBig(args[2], fname, loc) : 1n;
  const width = stop - start;
  if (step === 1n) {
    if (width > 0n) return normInt(start + randbelow(width));
    throw new PyError('ValueError', `random.${fname}() の範囲が空です（${start}, ${stop}）`, loc);
  }
  if (step === 0n) throw new PyError('ValueError', 'random.randrange() の step に 0 は使えません', loc);
  // (width + step - 1) // step（正）・(width + step + 1) // step（負）を、Python の切り捨て除算で求める
  const floorDiv = (a, b) => { const q = a / b; return (a % b !== 0n && (a < 0n) !== (b < 0n)) ? q - 1n : q; };
  const n = step > 0n ? floorDiv(width + step - 1n, step) : floorDiv(width + step + 1n, step);
  if (n <= 0n) throw new PyError('ValueError', `random.${fname}() の範囲が空です（${start}, ${stop}, ${step}）`, loc);
  return normInt(start + step * randbelow(n));
}
