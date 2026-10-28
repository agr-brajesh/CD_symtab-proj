/* =============================================================================
   lexer.js - a small scanner for C / C++ / Java / JavaScript / Python-like source
   Produces the token stream a compiler front-end would feed to its symbol table:
   identifiers (id), reserved words (kw), and block delimiters ({ and }).
   ============================================================================= */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'));
  else root.SymLexer = factory(root.SymEngine);
})(typeof self !== 'undefined' ? self : this, function (E) {
'use strict';

const KEYWORDS = new Set(('auto break case char const continue default do double else enum extern float for goto if inline int long register ' +
  'return short signed sizeof static struct switch typedef union unsigned void volatile while class public private protected new delete this ' +
  'true false null nullptr try catch throw namespace using template typename virtual override final import package interface extends implements ' +
  'boolean byte instanceof synchronized throws abstract bool def lambda None True False and or not in is pass from as with yield async await ' +
  'elif except finally global nonlocal raise del assert var let function export constructor').split(' '));

const isIdStart = c => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_' || c === '$';
const isIdPart = c => isIdStart(c) || (c >= '0' && c <= '9');
const isDigit = c => c >= '0' && c <= '9';

function tokenize(src) {
  const toks = []; const n = src.length; let i = 0, line = 1;
  while (i < n) {
    const c = src[i];
    if (c === '\n') { line++; i++; continue; }
    if (c === ' ' || c === '\t' || c === '\r') { i++; continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') { i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') line++; i++; } i += 2; continue; }
    if (c === '#') { while (i < n && src[i] !== '\n') i++; continue; }            // preprocessor line or Python comment
    if (c === '"' || c === "'" || c === '`') {
      const triple = src.startsWith(c + c + c, i);
      if (triple) { i += 3; while (i < n && !src.startsWith(c + c + c, i)) { if (src[i] === '\n') line++; i++; } i += 3; continue; }
      i++; while (i < n && src[i] !== c && src[i] !== '\n') { if (src[i] === '\\') i++; i++; }
      i++; continue;
    }
    if (isDigit(c)) { while (i < n && (isIdPart(src[i]) || src[i] === '.')) i++; continue; }
    if (isIdStart(c)) {
      let j = i + 1; while (j < n && isIdPart(src[j])) j++;
      const v = src.slice(i, j); toks.push({ t: KEYWORDS.has(v) ? 'kw' : 'id', v, line }); i = j; continue;
    }
    if (c === '{') toks.push({ t: '{', v: '{', line });
    else if (c === '}') toks.push({ t: '}', v: '}', line });
    i++;
  }
  return toks;
}

/* statistics about a token stream */
function describe(toks, src) {
  const freq = new Map(); let ids = 0, kws = 0, len = 0, depth = 0, maxDepth = 0, blocks = 0;
  for (const t of toks) {
    if (t.t === 'id') { ids++; len += t.v.length; freq.set(t.v, (freq.get(t.v) || 0) + 1); }
    else if (t.t === 'kw') kws++;
    else if (t.t === '{') { depth++; blocks++; if (depth > maxDepth) maxDepth = depth; }
    else if (t.t === '}' && depth > 0) depth--;
  }
  const top = [...freq.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 10);
  return { lines: src.split('\n').length, tokens: toks.length, identifiers: ids, unique: freq.size, keywords: kws, avgLen: ids ? len / ids : 0,
           maxDepth, blocks, top, reuse: ids ? 1 - freq.size / ids : 0, uniqueNames: [...freq.keys()] };
}

/* the symbol-table traffic a compiler produces for a token stream:
   resolve every identifier through the scope chain, declare it in the current scope when it is new.
   opt: { preload: put reserved words in the table first (and look them up like identifiers), scopes: braces open/close scopes } */
function buildOps(toks, opt) {
  const OP = E.OP, pairs = [], stack = [new Set()]; let resolved = 0, declared = 0, kwHits = 0;
  const phases = [];
  if (opt.preload) {
    const kw = [...KEYWORDS];
    phases.push({ name: 'keywords', reps: 1, ops: E.mkOps(kw.map(k => [OP.SD, k])), expectedFound: kw.length });
    for (const k of kw) stack[0].add(k);
  }
  for (const t of toks) {
    if (t.t === '{' && opt.scopes) { pairs.push([OP.SE]); stack.push(new Set()); }
    else if (t.t === '}' && opt.scopes) { if (stack.length > 1) { pairs.push([OP.SX]); stack.pop(); } else pairs.push([OP.SX]); }
    else if (t.t === 'kw') { if (opt.preload) { pairs.push([OP.SR, t.v]); kwHits++; resolved++; } }
    else if (t.t === 'id') {
      pairs.push([OP.SR, t.v]);
      let found = false; for (let d = stack.length - 1; d >= 0; d--) if (stack[d].has(t.v)) { found = true; break; }
      if (found) resolved++; else { pairs.push([OP.SD, t.v]); stack[stack.length - 1].add(t.v); declared++; }
    }
  }
  phases.push({ name: 'program', reps: 1, ops: E.mkOps(pairs), expectedFound: resolved + declared });
  return { phases, resolved, declared, kwHits, ops: pairs.length };
}

/* ---------------------------------------------------------------- samples */
const SAMPLES = {
  c: { label: 'C program (small)', code: `#include <stdio.h>
#define MAX 100

int counter = 0;

int fib(int n) {
    if (n < 2) {
        return n;
    }
    int a = fib(n - 1);
    int b = fib(n - 2);
    return a + b;
}

void fill(int *buffer, int length) {
    for (int i = 0; i < length; i++) {
        int value = fib(i % 10);
        buffer[i] = value * counter;
        if (value > 20) {
            int overflow = value - 20;
            counter = counter + overflow;
        }
    }
}

int main() {
    int data[MAX];
    int total = 0;
    fill(data, MAX);
    for (int i = 0; i < MAX; i++) {
        int value = data[i];
        total += value;
        while (value > 0) {
            int digit = value % 10;
            total += digit;
            value = value / 10;
        }
    }
    printf("%d\\n", total);
    return 0;
}
` },
  java: { label: 'Java class (small)', code: `public class Account {
    private double balance;
    private String owner;
    private int transactions;

    public Account(String owner, double initial) {
        this.owner = owner;
        this.balance = initial;
        this.transactions = 0;
    }

    public void deposit(double amount) {
        if (amount <= 0) {
            throw new IllegalArgumentException("bad amount");
        }
        balance = balance + amount;
        transactions++;
    }

    public boolean withdraw(double amount) {
        if (amount > balance) {
            return false;
        }
        balance -= amount;
        transactions++;
        return true;
    }

    public static void main(String[] args) {
        Account acc = new Account("Asha", 100.0);
        for (int i = 0; i < 5; i++) {
            double amount = i * 10.5;
            acc.deposit(amount);
            if (!acc.withdraw(amount / 2)) {
                System.out.println("failed " + i);
            }
        }
    }
}
` },
  py: { label: 'Python script (no braces)', code: `import math

def area(radius):
    return math.pi * radius * radius

def describe(shapes):
    total = 0
    for name, size in shapes:
        value = area(size)
        total = total + value
        print(name, value)
    return total

shapes = [("small", 1.0), ("medium", 2.5), ("large", 4.0)]
result = describe(shapes)
print("total area", result)
` },
};

/* deterministic generator: a larger C-like program with realistic name reuse (locals shadow, globals recur) */
function generateProgram(targetLines, seed) {
  const r = E.makeRng(seed || 7);
  const pool = ['i','j','k','n','m','x','y','z','tmp','len','count','index','buf','ptr','node','next','prev','head','tail','size','value','key','data','flag','state','error','result','offset','limit','total','sum','max','min','left','right','mid','temp','item','entry','table','scope','name','type'];
  const globals = []; const lines = [];
  for (let g = 0; g < 40; g++) { const nm = 'g_' + pool[r() % pool.length] + '_' + g; globals.push(nm); lines.push('int ' + nm + ' = ' + (r() % 100) + ';'); }
  let f = 0;
  while (lines.length < targetLines) {
    const fname = 'func_' + pool[r() % pool.length] + '_' + (f++); const params = ['a', 'b', 'c'].map(p => p + '_' + pool[r() % pool.length]);
    lines.push('int ' + fname + '(int ' + params.join(', int ') + ') {');
    const locals = params.slice(); let depth = 1;
    const pick = () => { const q = r() % 10; if (q < 5 && locals.length) return locals[r() % locals.length]; if (q < 8) return globals[r() % globals.length]; return pool[r() % pool.length]; };
    const body = 8 + r() % 25;
    for (let s = 0; s < body && lines.length < targetLines + 40; s++) {
      const ind = '    '.repeat(depth), q = r() % 10;
      if (q < 3) { const v = pool[r() % pool.length] + (r() % 4 ? '' : '_' + (r() % 50)); lines.push(ind + 'int ' + v + ' = ' + pick() + ' + ' + pick() + ';'); locals.push(v); }
      else if (q < 6) lines.push(ind + pick() + ' = ' + pick() + ' * ' + pick() + ' - ' + pick() + ';');
      else if (q < 7 && depth < 4) { lines.push(ind + 'if (' + pick() + ' > ' + pick() + ') {'); depth++; }
      else if (q < 8 && depth < 4) { lines.push(ind + 'for (int i = 0; i < ' + pick() + '; i++) {'); depth++; }
      else if (q < 9 && depth > 1) { depth--; lines.push('    '.repeat(depth) + '}'); }
      else lines.push(ind + 'result = ' + fname.replace(/_\d+$/, '') + '(' + pick() + ', ' + pick() + ', ' + pick() + ');');
    }
    while (depth > 1) { depth--; lines.push('    '.repeat(depth) + '}'); }
    lines.push('    return ' + pick() + ';'); lines.push('}'); lines.push('');
  }
  return lines.join('\n');
}

return { KEYWORDS, tokenize, describe, buildOps, SAMPLES, generateProgram };
});
