---
name: javascript-formatting
description: Use when writing or reviewing JavaScript in this repo (`bin/`, `lib/`, `test/`), especially when placing exports or deciding where blank lines go around variable declarations, return statements, and control-flow blocks. Covers two conventions that oxfmt and oxlint do not enforce: (1) one `export { ... }` statement at the end of the file instead of `export` on each declaration, and (2) blank-line placement around declaration blocks, `return`, and block-bodied statements like `if`, `while`, `do...while`, `for`, `switch`, and `try`.
---

# JavaScript formatting

Two house conventions beyond what `oxfmt` and `oxlint` enforce. Both make a file's shape readable
at a glance. Apply them to new code and to code you are already changing; do not reformat
untouched code just to apply them.

## Exports at the end of the file

Do not put `export` on an individual declaration:

```js
// Don't
export function costOf(calls, rates) { ... }
export const PATH_MIN = 20;
```

Declare everything without `export`, then list every exported name in one statement at the end of
the file, sorted alphabetically:

```js
// Do
function costOf(calls, rates) { ... }
const PATH_MIN = 20;

export { costOf, PATH_MIN };
```

This keeps a module's public interface in one place, readable without scanning the whole file for
scattered `export` keywords.

Notes:

- A file under `lib/` exports what other files or tests import, and nothing else. Add a name to
  its `export { … }` when something needs it, not in case someone might.
- `bin/dclaude.mjs` exports nothing; it is the command.
- A re-export (`export { x } from "./other.mjs"`) belongs at the end too, grouped with the file's
  other exports.
- Test files (`*.test.mjs`) export nothing; `test/helpers.mjs` exports the shared fixtures.

## Blank lines around declarations, returns, and blocks

1. **After a block of variable declarations.** One or more consecutive `const`/`let`/`var`
   declarations get a blank line after the last one, before the next statement.

   ```js
   function total(calls) {
     const costs = calls.map((c) => c.cost);
     const sum = costs.reduce((a, b) => a + b, 0);

     return Math.round(sum * 100) / 100;
   }
   ```

2. **Before a `return`.** Unless it is the first statement in its block (nothing precedes it to
   separate from).

   ```js
   function clamp(x) {
     if (x < 0) {
       return 0;
     }

     return x;
   }
   ```

3. **Before and after a block-bodied statement**: `if`/`else`, `while`, `do...while`, `for`
   (including `for...of`/`for...in`), `switch`, `try`/`catch`/`finally`. **Unless** that
   statement is the first or last thing in its enclosing block, in which case skip the blank line
   on that side (it is already next to the enclosing `{`/`}`).

   ```js
   function readRecords(path) {
     // First in its block: no blank line needed before it.
     if (!existsSync(path)) {
       return [];
     }

     const out = [];

     for (const line of readFileSync(path, "utf8").split("\n")) {
       out.push(line);
     }

     return out;
   }
   ```

When two of these rules call for a blank line in the same place (a block of declarations
immediately followed by a `return`, or a declaration followed by an `if`), insert a single blank
line; never stack two.

Scope: this applies to control-flow statements, not to function or class bodies. A function
declaration right after some `const`s still only needs the one blank line the declaration-block
rule already calls for.

Single-line statements such as `if (!path) return null;` are not block-bodied; rule 3 does not
apply to them. They are common in `lib/` and fine to keep.

In tests, an `assert` group counts as an ordinary statement: put the blank line after the
declarations that set it up, as in `test/present.test.mjs`.
