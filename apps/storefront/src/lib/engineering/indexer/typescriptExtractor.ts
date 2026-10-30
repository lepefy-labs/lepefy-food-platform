/**
 * Syntactic extraction from TypeScript/JavaScript with the TypeScript Compiler API
 * (parse only: no type checking, no program, fast and deterministic).
 *
 * Every fact comes from the syntax tree of the file: top-level declarations,
 * import specifiers, string-literal `.from('table')` / `.rpc('name')` / `fetch('/api/…')`
 * calls and test titles. Nothing is inferred: a dynamic argument produces no relation.
 */
import ts from 'typescript';
import { createHash } from 'node:crypto';
import { LIMITS, type SymbolKind } from '../domain';

export interface RawSymbol {
  name: string;
  kind: SymbolKind;
  exported: boolean;
  signature: string | null;
  startLine: number;
  endLine: number;
  contentHash: string;
  parentName: string | null;
  /** Leading comment text, used only for the search chunk. */
  doc: string | null;
}

export interface RawImport {
  specifier: string;
  line: number;
}

export interface RawReference {
  kind: 'uses_table' | 'calls_rpc' | 'calls_api';
  target: string;
  line: number;
}

export interface TypeScriptFacts {
  symbols: RawSymbol[];
  imports: RawImport[];
  references: RawReference[];
  /** First block comment of the file, when it documents the module. */
  headerComment: string | null;
}

const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);
const TEST_CALLEES = new Set(['test', 'it']);
const DESCRIBE_CALLEES = new Set(['describe']);
const API_PATH = /^\/api\/[A-Za-z0-9_\-/[\]${}.]*$/;
const TABLE_NAME = /^[a-z_][a-z0-9_]{1,62}$/;
const RPC_NAME = /^[a-z_][a-z0-9_]{1,62}$/;

function sha1(text: string): string {
  return createHash('sha1').update(text).digest('hex');
}

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function cleanComment(raw: string): string {
  return raw
    .replace(/^\/\*+/, '')
    .replace(/\*+\/$/, '')
    .split('\n')
    .map((line) => line.replace(/^\s*\*\s?/, '').replace(/^\s*\/\/\s?/, ''))
    .join('\n')
    .trim();
}

function leadingDoc(node: ts.Node, source: ts.SourceFile): string | null {
  const ranges = ts.getLeadingCommentRanges(source.text, node.getFullStart());
  if (!ranges || ranges.length === 0) return null;
  const last = ranges[ranges.length - 1]!;
  const text = cleanComment(source.text.slice(last.pos, last.end));
  return text ? text.slice(0, 1000) : null;
}

function isExported(node: ts.Node): boolean {
  return (ts.getCombinedModifierFlags(node as ts.Declaration) & ts.ModifierFlags.Export) !== 0;
}

function scriptKind(path: string): ts.ScriptKind {
  if (path.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (path.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (/\.[cm]?js$/.test(path)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function stringLiteralOf(node: ts.Node | undefined): string | null {
  if (!node) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return null;
}

function headerOf(node: ts.Node, source: ts.SourceFile, end: number): string {
  const start = node.getStart(source);
  const raw = source.text.slice(start, Math.min(end, start + 2000));
  return collapse(raw).slice(0, LIMITS.maxSignature);
}

export function extractTypeScript(path: string, content: string): TypeScriptFacts {
  const source = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true, scriptKind(path));
  const isTsx = path.endsWith('.tsx');
  const isRoute = /\/route\.[jt]s$/.test(path);
  const symbols: RawSymbol[] = [];
  const imports: RawImport[] = [];
  const references: RawReference[] = [];

  const lineOf = (position: number) => source.getLineAndCharacterOfPosition(position).line + 1;
  const push = (node: ts.Node, name: string, kind: SymbolKind, exported: boolean, signature: string | null, parentName: string | null) => {
    if (!name) return;
    symbols.push({
      name: name.slice(0, LIMITS.maxSymbolName),
      kind,
      exported,
      signature: signature ? signature.slice(0, LIMITS.maxSignature) : null,
      startLine: lineOf(node.getStart(source)),
      endLine: lineOf(node.getEnd()),
      contentHash: sha1(node.getText(source)),
      parentName,
      doc: leadingDoc(node, source),
    });
  };

  const functionKind = (name: string, exported: boolean): SymbolKind => {
    if (isRoute && exported && HTTP_METHODS.has(name)) return 'route_handler';
    if (/^use[A-Z0-9]/.test(name)) return 'hook';
    if (isTsx && /^[A-Z]/.test(name)) return 'component';
    return 'function';
  };

  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement)) {
      const specifier = stringLiteralOf(statement.moduleSpecifier);
      if (specifier) imports.push({ specifier, line: lineOf(statement.getStart(source)) });
    } else if (ts.isExportDeclaration(statement) && statement.moduleSpecifier) {
      const specifier = stringLiteralOf(statement.moduleSpecifier);
      if (specifier) imports.push({ specifier, line: lineOf(statement.getStart(source)) });
    } else if (ts.isFunctionDeclaration(statement)) {
      const exported = isExported(statement);
      const isDefault = (ts.getCombinedModifierFlags(statement) & ts.ModifierFlags.Default) !== 0;
      const name = statement.name?.text ?? (isDefault ? 'default' : '');
      const bodyStart = statement.body ? statement.body.getStart(source) : statement.getEnd();
      push(statement, name, functionKind(name, exported), exported, headerOf(statement, source, bodyStart), null);
    } else if (ts.isClassDeclaration(statement)) {
      const name = statement.name?.text ?? 'default';
      const firstBrace = statement.members.pos - 1;
      push(statement, name, 'class', isExported(statement), headerOf(statement, source, firstBrace), null);
    } else if (ts.isInterfaceDeclaration(statement)) {
      push(statement, statement.name.text, 'interface', isExported(statement), `interface ${statement.name.text}`, null);
    } else if (ts.isTypeAliasDeclaration(statement)) {
      push(statement, statement.name.text, 'type', isExported(statement), headerOf(statement, source, statement.end), null);
    } else if (ts.isEnumDeclaration(statement)) {
      push(statement, statement.name.text, 'enum', isExported(statement), `enum ${statement.name.text}`, null);
    } else if (ts.isVariableStatement(statement)) {
      const exported = isExported(statement);
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) continue;
        const name = declaration.name.text;
        const init = declaration.initializer;
        const isFn = init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init));
        const kind: SymbolKind = isFn ? functionKind(name, exported) : 'const';
        const signature = isFn
          ? headerOf(declaration, source, (init as ts.ArrowFunction).body.getStart(source))
          : headerOf(declaration, source, declaration.end);
        const symbolNode = statement.declarationList.declarations.length === 1 ? statement : declaration;
        symbols.push({
          name: name.slice(0, LIMITS.maxSymbolName),
          kind,
          exported,
          signature: signature.slice(0, LIMITS.maxSignature),
          startLine: lineOf(symbolNode.getStart(source)),
          endLine: lineOf(symbolNode.getEnd()),
          contentHash: sha1(symbolNode.getText(source)),
          parentName: null,
          doc: leadingDoc(symbolNode, source),
        });
      }
    } else if (ts.isExportAssignment(statement)) {
      push(statement, 'default', 'const', true, headerOf(statement, source, statement.end), null);
    }
  }

  // Calls anywhere in the file: dynamic imports, require, table/RPC/API literals, test titles.
  const visit = (node: ts.Node, describeStack: string[]) => {
    let stack = describeStack;
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const firstArg = stringLiteralOf(node.arguments[0]);
      if (ts.isIdentifier(callee) && callee.text === 'require' && firstArg) {
        imports.push({ specifier: firstArg, line: lineOf(node.getStart(source)) });
      } else if (callee.kind === ts.SyntaxKind.ImportKeyword && firstArg) {
        imports.push({ specifier: firstArg, line: lineOf(node.getStart(source)) });
      } else if (ts.isPropertyAccessExpression(callee) && firstArg) {
        const method = callee.name.text;
        if (method === 'from' && TABLE_NAME.test(firstArg)) {
          references.push({ kind: 'uses_table', target: firstArg, line: lineOf(node.getStart(source)) });
        } else if (method === 'rpc' && RPC_NAME.test(firstArg)) {
          references.push({ kind: 'calls_rpc', target: firstArg, line: lineOf(node.getStart(source)) });
        }
      }
      if (ts.isIdentifier(callee) && callee.text === 'fetch' && firstArg && API_PATH.test(firstArg.split('?')[0] ?? '')) {
        references.push({ kind: 'calls_api', target: firstArg.split('?')[0] ?? firstArg, line: lineOf(node.getStart(source)) });
      }

      // Playwright/Jest-style tests: test('title'), it('title'), describe('x'), test.describe('x').
      const head = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) ? callee.expression.text : null;
      const tail = ts.isPropertyAccessExpression(callee) ? callee.name.text : null;
      if (head && firstArg) {
        const isDescribe = DESCRIBE_CALLEES.has(head) || (head === 'test' && tail === 'describe');
        const isTest = !isDescribe && TEST_CALLEES.has(head) && (tail === null || tail === 'only' || tail === 'skip' || tail === 'fixme');
        if (isDescribe) {
          push(node, firstArg, 'test', false, null, describeStack[describeStack.length - 1] ?? null);
          stack = [...describeStack, firstArg];
        } else if (isTest) {
          push(node, firstArg, 'test', false, null, describeStack[describeStack.length - 1] ?? null);
        }
      }
    }
    ts.forEachChild(node, (child) => visit(child, stack));
  };
  visit(source, []);

  const firstComment = ts.getLeadingCommentRanges(source.text, 0)?.[0];
  const headerComment = firstComment ? cleanComment(source.text.slice(firstComment.pos, firstComment.end)).slice(0, 1500) || null : null;

  return { symbols, imports, references, headerComment };
}
