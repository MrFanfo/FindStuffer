import { describe, expect, it } from 'vitest';
import { parseImportJson } from './strictJson';

describe('strict import JSON', () => {
  it('preserves strings, nested arrays and escaped keys', () => {
    expect(parseImportJson('{"operations":[{"data":{"name":"A > B", "notes":"quote: \\\""}}]}').operations).toHaveLength(1);
  });
  it.each(['{"name":"A","name":"B"}', '{"name":1,"\\u006eame":2}', '{"a":{"x":1,"x":2}}'])('rejects duplicate keys: %s', (source) => expect(() => parseImportJson(source)).toThrow(/Duplicate JSON key/));
  it.each(['{"a":1,}', '{/*comment*/"a":1}', '{"a":NaN}', '{"a": [1,]}', '{} trailing', '[]'])('rejects invalid JSON: %s', (source) => expect(() => parseImportJson(source)).toThrow());
  it('rejects excessive nesting', () => expect(() => parseImportJson('{"a":'.repeat(34) + '0' + '}'.repeat(34))).toThrow(/nesting/));
});
