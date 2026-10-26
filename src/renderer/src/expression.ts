/**
 * Arithmetic typed into number fields and dimension values: + − × ÷ (also * and /), powers (^),
 * parentheses, π (pi), sqrt, abs, the trigonometric functions and their inverses in degrees, round, floor,
 * ceil, min and max of any number of values, and if(condition; then; else) with the comparisons < > <= >=
 * = <> (a condition is true when it is not 0). A number or a bracket may carry a length unit (mm, cm, m,
 * in, "), which converts it to millimeters. Both "." and "," are decimal separators, because German users
 * naturally type a comma; arguments are separated by ";" (or by a comma that is not between digits).
 * Names that are not one of these refer to the part's variables. Nothing is ever evaluated as code.
 */

const UNITS: Record<string, number> = { mm: 1, cm: 10, m: 1000, in: 25.4, '"': 25.4 };
const DEGREES = Math.PI / 180;
const FUNCTIONS: Record<string, (x: number) => number> = {
  sqrt: Math.sqrt,
  abs: Math.abs,
  sin: (x) => Math.sin(x * DEGREES),
  cos: (x) => Math.cos(x * DEGREES),
  tan: (x) => Math.tan(x * DEGREES),
  asin: (x) => Math.asin(x) / DEGREES,
  acos: (x) => Math.acos(x) / DEGREES,
  atan: (x) => Math.atan(x) / DEGREES,
  round: Math.round,
  floor: Math.floor,
  ceil: Math.ceil,
};
/** Functions of any number of values (at least one). */
const LIST_FUNCTIONS: Record<string, (values: number[]) => number> = {
  min: (values) => Math.min(...values),
  max: (values) => Math.max(...values),
};
const OPERATORS: Record<string, string> = { '×': '*', '·': '*', '÷': '/', '−': '-', '≤': '<=', '≥': '>=', '≠': '<>' };

/** Names an expression cannot use for variables (case does not matter). */
const RESERVED = new Set([...Object.keys(UNITS), ...Object.keys(FUNCTIONS), ...Object.keys(LIST_FUNCTIONS), 'if', 'pi', 'π']);

/** Whether `name` can name a variable: a letter or underscore, then letters, digits and underscores. */
export function isVariableName(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && !RESERVED.has(name.toLowerCase()) && name.length <= 64;
}

type Token = { kind: 'number'; value: number } | { kind: 'name'; value: string } | { kind: 'symbol'; value: string };

function tokenize(text: string): Token[] | null {
  const tokens: Token[] = [];
  let i = 0;
  while (i < text.length) {
    const char = text[i] as string;
    if (/\s/.test(char)) {
      i++;
      continue;
    }
    // A comma is a decimal separator only between digits; otherwise it separates arguments.
    const number = /^(\d+([.,]\d+)?\.?|[.,]\d+)/.exec(text.slice(i));
    if (number) {
      tokens.push({ kind: 'number', value: Number(number[0].replace(',', '.')) });
      i += number[0].length;
      continue;
    }
    const name = /^([a-zA-Z_][a-zA-Z0-9_]*|π)/.exec(text.slice(i));
    if (name) {
      tokens.push({ kind: 'name', value: name[0].toLowerCase() });
      i += name[0].length;
      continue;
    }
    const pair = text.slice(i, i + 2);
    if (pair === '<=' || pair === '>=' || pair === '<>') {
      tokens.push({ kind: 'symbol', value: pair });
      i += 2;
      continue;
    }
    const symbol = OPERATORS[char] ?? char;
    if (!'+-*/^()";,<>='.includes(symbol) && !['<=', '>=', '<>'].includes(symbol)) return null;
    // Both separate arguments.
    tokens.push({ kind: 'symbol', value: symbol === ',' ? ';' : symbol });
    i++;
  }
  return tokens;
}

/** The variable names an expression uses (lower case), or null if it is not an expression. */
export function variableNames(text: string): string[] | null {
  const tokens = tokenize(text);
  if (!tokens) return null;
  const names = new Set<string>();
  // Units, functions and π are reserved, so every other name is a variable.
  for (const token of tokens) if (token.kind === 'name' && !RESERVED.has(token.value)) names.add(token.value);
  return [...names];
}

/**
 * The value of an expression, or null if it is not one (or not a finite number). Variables are looked
 * up by lower-case name.
 */
export function evaluate(text: string, variables: ReadonlyMap<string, number> = new Map()): number | null {
  const tokens = tokenize(text);
  if (!tokens || tokens.length === 0) return null;
  let position = 0;
  const peek = () => tokens[position];
  const isSymbol = (value: string) => {
    const token = peek();
    return token?.kind === 'symbol' && token.value === value;
  };
  const fail = (): never => {
    throw new SyntaxError('invalid expression');
  };

  /** An optional unit after a number or a closing bracket. */
  const unit = (value: number): number => {
    const token = peek();
    if (token?.kind === 'symbol' && token.value === '"') {
      position++;
      return value * 25.4;
    }
    if (token?.kind === 'name' && token.value in UNITS) {
      position++;
      return value * (UNITS[token.value] as number);
    }
    return value;
  };
  const primary = (): number => {
    const token = peek();
    if (!token) return fail();
    position++;
    if (token.kind === 'number') return unit(token.value);
    if (token.kind === 'symbol' && token.value === '(') {
      const value = sum();
      if (!isSymbol(')')) fail();
      position++;
      return unit(value);
    }
    if (token.kind === 'name') {
      if (token.value === 'pi' || token.value === 'π') return Math.PI;
      const variable = variables.get(token.value);
      if (variable !== undefined && !isSymbol('(')) return unit(variable);
      const fn = FUNCTIONS[token.value];
      const list = LIST_FUNCTIONS[token.value];
      if ((fn || list || token.value === 'if') && isSymbol('(')) {
        position++;
        const values = [comparison()];
        while (isSymbol(';')) {
          position++;
          values.push(comparison());
        }
        if (!isSymbol(')')) fail();
        position++;
        if (fn) return values.length === 1 ? fn(values[0] as number) : fail();
        if (list) return list(values);
        // if(condition; then; else)
        return values.length === 3 ? ((values[0] as number) !== 0 ? (values[1] as number) : (values[2] as number)) : fail();
      }
    }
    return fail();
  };
  const unary = (): number => {
    if (isSymbol('-')) {
      position++;
      return -unary();
    }
    if (isSymbol('+')) {
      position++;
      return unary();
    }
    return power();
  };
  const power = (): number => {
    const base = primary();
    if (!isSymbol('^')) return base;
    position++;
    return base ** unary();
  };
  const product = (): number => {
    let value = unary();
    while (isSymbol('*') || isSymbol('/')) {
      const divide = isSymbol('/');
      position++;
      const right = unary();
      value = divide ? value / right : value * right;
    }
    return value;
  };
  function sum(): number {
    let value = product();
    while (isSymbol('+') || isSymbol('-')) {
      const minus = isSymbol('-');
      position++;
      const right = product();
      value = minus ? value - right : value + right;
    }
    return value;
  }
  /** A sum, or two sums compared (1 when the comparison holds, else 0); conditions of if() use them. */
  function comparison(): number {
    const left = sum();
    const token = peek();
    if (token?.kind !== 'symbol' || !['<', '>', '<=', '>=', '=', '<>'].includes(token.value)) return left;
    position++;
    const right = sum();
    const tolerance = 1e-9 * Math.max(1, Math.abs(left), Math.abs(right));
    switch (token.value) {
      case '<':
        return left < right - tolerance ? 1 : 0;
      case '>':
        return left > right + tolerance ? 1 : 0;
      case '<=':
        return left <= right + tolerance ? 1 : 0;
      case '>=':
        return left >= right - tolerance ? 1 : 0;
      case '=':
        return Math.abs(left - right) <= tolerance ? 1 : 0;
      default:
        return Math.abs(left - right) > tolerance ? 1 : 0;
    }
  }

  try {
    const value = sum();
    if (position !== tokens.length) return null;
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}
