import { access, readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const threeStubUrl = pathToFileURL(path.join(root, 'scripts/test-stubs/three.mjs')).href;

let ts;
try {
  ts = await import('typescript');
} catch (localError) {
  // A normal project install resolves the local devDependency above. For dependency-
  // constrained CI sandboxes, also try the TypeScript package installed beside the
  // active Node runtime instead of hard-coding a machine/version-specific path.
  const globalTypeScriptPath = path.resolve(
    path.dirname(process.execPath),
    '..',
    'lib',
    'node_modules',
    'typescript',
    'lib',
    'typescript.js',
  );
  try {
    await access(globalTypeScriptPath);
    ts = await import(pathToFileURL(globalTypeScriptPath).href);
  } catch {
    throw new Error(
      'The mesh construction test requires the TypeScript devDependency. Run npm install before testing.',
      { cause: localError },
    );
  }
}
const typescript = ts.default ?? ts;

async function firstExisting(basePath) {
  const candidates = path.extname(basePath)
    ? [basePath]
    : [`${basePath}.ts`, `${basePath}.tsx`, `${basePath}.js`, `${basePath}.mjs`, path.join(basePath, 'index.ts'), path.join(basePath, 'index.tsx')];
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Continue.
    }
  }
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'three') {
    return { url: threeStubUrl, shortCircuit: true };
  }

  if (specifier.startsWith('@/')) {
    const resolved = await firstExisting(path.join(root, specifier.slice(2)));
    if (!resolved) throw new Error(`Unable to resolve test alias: ${specifier}`);
    return { url: pathToFileURL(resolved).href, shortCircuit: true };
  }

  if ((specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL?.startsWith('file:')) {
    const parentPath = path.dirname(fileURLToPath(context.parentURL));
    const resolved = await firstExisting(path.resolve(parentPath, specifier));
    if (resolved) return { url: pathToFileURL(resolved).href, shortCircuit: true };
  }

  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url.endsWith('.ts') || url.endsWith('.tsx')) {
    const source = await readFile(fileURLToPath(url), 'utf8');
    const output = typescript.transpileModule(source, {
      compilerOptions: {
        target: typescript.ScriptTarget.ES2020,
        module: typescript.ModuleKind.ESNext,
        jsx: typescript.JsxEmit.ReactJSX,
        isolatedModules: true,
      },
      fileName: fileURLToPath(url),
      reportDiagnostics: true,
    });
    const errors = output.diagnostics?.filter(diagnostic => diagnostic.category === typescript.DiagnosticCategory.Error) ?? [];
    if (errors.length > 0) {
      const message = typescript.formatDiagnosticsWithColorAndContext(errors, {
        getCanonicalFileName: name => name,
        getCurrentDirectory: () => root,
        getNewLine: () => '\n',
      });
      throw new Error(message);
    }
    return { format: 'module', source: output.outputText, shortCircuit: true };
  }
  return nextLoad(url, context);
}
