// Reads Codex's installed archive without changing the application or profile.
// Only the portable cursor renderer, path math and embedded PNG are retained.
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { extractFile, listPackage } from "@electron/asar";
import { build } from "esbuild";
import ts from "typescript";

const archive = process.argv[2];
if (!archive || !path.isAbsolute(archive)) throw new Error("Pass the absolute path to Codex's app.asar.");
const entries = listPackage(archive);
const entry = pattern => {
  const matches = entries.filter(name => pattern.test(name.replace(/\\/g, "/")));
  if (matches.length !== 1) throw new Error(`Expected one archive entry for ${pattern}. Inspect the current Codex build.`);
  return matches[0].replace(/^[/\\]/, "");
};
const read = name => extractFile(archive, name).toString("utf8");
const cursorFile = entry(/\/webview\/assets\/cursor-chat-[\w]+\.js$/);
const cursorSource = read(cursorFile);
const cursorAst = ts.createSourceFile("cursor.js", cursorSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const imports = cursorAst.statements.filter(ts.isImportDeclaration);
const mathImport = imports.find(node => node.moduleSpecifier.text.startsWith("./app-initial-"));
const lazyImport = imports.find(node => node.moduleSpecifier.text.startsWith("./rolldown-runtime-"));
if (!mathImport || !lazyImport || imports.length !== 2) throw new Error("Cursor dependencies changed; inspect before extracting.");
const mathFile = path.join(path.dirname(cursorFile), path.basename(mathImport.moduleSpecifier.text));
const mathSource = read(mathFile);
const mathAst = ts.createSourceFile("math.js", mathSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const aliases = new Map();
for (const node of mathAst.statements) if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause)) {
  for (const item of node.exportClause.elements) aliases.set(item.name.text, (item.propertyName ?? item.name).text);
}
const exports = mathImport.importClause.namedBindings.elements.map(item => (item.propertyName ?? item.name).text);
const start = mathAst.statements.findIndex(node => ts.isFunctionDeclaration(node) && node.name?.text === aliases.get("LGt"));
const end = mathAst.statements.findIndex(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(item => item.name.getText(mathAst) === aliases.get("VGt")));
const mathFunctions = mathAst.statements.slice(start, end);
if (start < 0 || end <= start || mathFunctions.length !== 26 || mathFunctions.some(node => !ts.isFunctionDeclaration(node))) throw new Error("Cursor path math changed; inspect before extracting.");
const declarations = mathAst.statements[end].declarationList.declarations;
const initializerIndex = declarations.findIndex(item => item.name.getText(mathAst) === aliases.get("VGt"));
const initializer = declarations[initializerIndex];
if (!ts.isCallExpression(initializer.initializer) || initializer.initializer.arguments.length !== 1) throw new Error("Cursor initializer changed.");
const mathModule = [
  ...mathFunctions.map(node => node.getText(mathAst)),
  `let ${declarations.slice(0, initializerIndex).map(item => item.getText(mathAst)).join(",")};`,
  `const ${initializer.name.text} = ${initializer.initializer.arguments[0].getText(mathAst)};`,
  `export { ${exports.map(name => `${aliases.get(name)} as ${name}`).join(", ")} };`
].join("\n");
const cursorModule = cursorSource
  .replaceAll(mathImport.moduleSpecifier.text, "cursor-math")
  .replaceAll(lazyImport.moduleSpecifier.text, "cursor-init");
const bundled = await build({
  stdin: { contents: `import { a as create, i as init, n as initAsset, t as asset } from "cursor-renderer";
    init(); initAsset();
    export const createCursor = (container, options = {}) => create(container, { assetUrl: asset, glowColor: "#339cff", ...options });`, loader: "js" },
  plugins: [{ name: "portable-cursor", setup(builder) {
    builder.onResolve({ filter: /^cursor-(renderer|math|init)$/ }, args => ({ path: args.path, namespace: "cursor" }));
    builder.onLoad({ filter: /.*/, namespace: "cursor" }, args => ({ contents: args.path === "cursor-renderer" ? cursorModule : args.path === "cursor-math" ? mathModule :
      "export const n = initialize => { let initialized = false; return () => { if (!initialized) { initialized = true; initialize(); } }; };", loader: "js" }));
  } }],
  bundle: true, write: false, platform: "browser", format: "iife", globalName: "CodexBrowserCursor",
  target: "chrome130", minify: false, drop: ["console"], legalComments: "none", logLevel: "silent"
});
const code = bundled.outputFiles[0].text;
const plugin = path.resolve("community/plugins/in-built-browser");
const vendor = path.join(plugin, "vendor");
await fs.mkdir(vendor, { recursive: true });
await fs.writeFile(path.join(vendor, "codex-browser-cursor.js"), code);
const provenance = {
  product: "OpenAI Codex", version: JSON.parse(read("package.json")).version,
  sources: [{ file: cursorFile, sha256: createHash("sha256").update(cursorSource).digest("hex") }, { file: mathFile, sha256: createHash("sha256").update(mathSource).digest("hex") }],
  extraction: "Original cursor spring renderer, Bezier path selection, motion constants and embedded PNG. App bootstrap replaced with a local initializer; no app services, telemetry, profile or credentials.",
  outputSha256: createHash("sha256").update(code).digest("hex")
};
await fs.writeFile(path.join(vendor, "cursor-provenance.json"), JSON.stringify(provenance, null, 2) + "\n");
// Plugin entry points are plain scripts. Embed this static bundle so loading it
// does not require eval, a new global API, or a network request at runtime.
const begin = "// BEGIN CODEX CURSOR — generated by scripts/extract-codex-browser-cursor.mjs";
const endMarker = "// END CODEX CURSOR";
const main = path.join(plugin, "index.js");
let source = await fs.readFile(main, "utf8");
const previous = source.indexOf(begin);
if (previous >= 0) {
  const end = source.indexOf(endMarker, previous);
  if (end < 0) throw new Error("Missing generated cursor end marker.");
  source = source.slice(0, previous) + source.slice(end + endMarker.length).replace(/^\r?\n/, "");
}
await fs.writeFile(main, `${begin}\n${code}${endMarker}\n${source}`);
process.stdout.write(`Extracted Codex's cursor renderer and PNG (${code.length} bytes); embedded in the browser entry point.\n`);
