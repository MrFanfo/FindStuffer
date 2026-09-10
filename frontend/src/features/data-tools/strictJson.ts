/** JSON.parse accepts duplicate keys; imports must reject them before parsing loses evidence. */
export function parseImportJson(source: string): Record<string, unknown> {
  if (new TextEncoder().encode(source).length > 4 * 1024 * 1024) throw new Error('Import exceeds 4 MiB. Split it into smaller files.');
  let position = 0;
  const whitespace = () => { while (/\s/.test(source[position] || '') && position < source.length) position++; };
  function string(): string {
    const start = position++;
    while (position < source.length) {
      const char = source[position++];
      if (char === '\\') position++;
      else if (char === '"') return JSON.parse(source.slice(start, position)) as string;
    }
    throw new Error('Unterminated JSON string');
  }
  function value(depth: number): void {
    if (depth > 32) throw new Error('Import nesting exceeds 32 levels');
    whitespace();
    const char = source[position];
    if (char === '"') { string(); return; }
    if (char === '{' || char === '[') {
      const object = char === '{'; const end = object ? '}' : ']'; const keys = new Set<string>();
      position++; whitespace();
      if (source[position] === end) { position++; return; }
      while (position < source.length) {
        whitespace();
        if (object) {
          if (source[position] !== '"') throw new Error('JSON object keys must be quoted');
          const key = string();
          if (keys.has(key)) throw new Error(`Duplicate JSON key: ${key}`);
          keys.add(key); whitespace();
          if (source[position++] !== ':') throw new Error('Expected a colon after JSON key');
        }
        value(depth + 1); whitespace();
        const separator = source[position++];
        if (separator === end) return;
        if (separator !== ',') throw new Error('Expected a comma or closing bracket');
      }
      throw new Error('Unclosed JSON object or array');
    }
    const start = position;
    while (position < source.length && !/[\s,}\]]/.test(source[position])) position++;
    if (start === position) throw new Error('Expected a JSON value; trailing commas are not allowed');
    const scalar: unknown = JSON.parse(source.slice(start, position));
    if (typeof scalar === "number" && !Number.isFinite(scalar)) throw new Error("Non-finite JSON number");
  }
  value(0); whitespace();
  if (position !== source.length) throw new Error('Unexpected content after JSON');
  const result: unknown = JSON.parse(source);
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('Import must be a JSON object');
  return result as Record<string, unknown>;
}
