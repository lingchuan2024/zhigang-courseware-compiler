import { describe, expect, it } from 'vitest';
import { findPythonCodeIssues } from '../python-code-quality';

describe('Python code layout checks', () => {
  it('detects OCR indentation damage and console output in executable fences', () => {
    expect(findPythonCodeIssues('```python\nclass Student:\n    def run(self):\n    # OCR lost indentation\n    print(1)\n```')).toHaveLength(1);
    expect(findPythonCodeIssues('```python\nMichael Simon: 98\n```')).toHaveLength(1);
  });
  it('detects unbalanced OCR brackets while ignoring strings and comments', () => {
    expect(findPythonCodeIssues("```python\nprint('%s: %d' % (name, score)))\n```")).toHaveLength(1);
    expect(findPythonCodeIssues('```python\nx = [1, 2\n```')).toHaveLength(1);
    expect(findPythonCodeIssues('```python\nx = [\n    "[)", # extra ) in comment\n    "text",\n]\n```')).toEqual([]);
  });
  it('keeps valid methods, inline suites, typed variables, docstrings and deliberate exceptions', () => {
    const code = '```python\nclass Student:\n    def run(self):\n        """Example:\nnot executable\n        """\n        score: int = 98\n        if score: print(score)\n        raise ValueError("expected example")\n\n    def next(self):\n        pass\n```';
    expect(findPythonCodeIssues(code)).toEqual([]);
    expect(findPythonCodeIssues('```text\nMichael Simon: 98\n```')).toEqual([]);
  });
  it('checks quoted Python and tilde fences without treating inner short fences as closers', () => {
    expect(findPythonCodeIssues('> ~~~python\n> def f():\n> pass\n> ~~~')).toHaveLength(1);
    expect(findPythonCodeIssues('````text\n```python\ndef f():\npass\n```\n````')).toEqual([]);
  });
});
