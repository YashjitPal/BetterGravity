// Extract only the portable client, command contracts, and DOM selector engine.
// The installed Codex application is read-only. No profile or credential files
// are accessed, and the Codex service, telemetry, and native bridge are omitted.
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { build, transform } from "esbuild";
import ts from "typescript";

const reference = process.argv[2];
if (!reference) throw new Error("Pass the absolute path to Codex's bundled plugins/browser directory.");
const destination = path.resolve("community/plugins/in-built-browser/vendor");
const read = name => fs.readFile(path.join(reference, name), "utf8");
const [client, service, manifestText, apiText] = await Promise.all([
  read("scripts/browser-client.mjs"), read("scripts/browser-service.mjs"),
  read(".codex-plugin/plugin.json"), read("docs/api.json")
]);
const ast = ts.createSourceFile("client.mjs", client, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const commands = [];
let factory;
function visit(node) {
  if (ts.isCallExpression(node) && node.arguments.length >= 2 && ts.isIdentifier(node.arguments[0]) && ts.isObjectLiteralExpression(node.arguments[1])) {
    const keys = node.arguments[1].properties.map(p => p.name?.getText(ast));
    if (keys.includes("PayloadSchema") && keys.includes("commandType")) commands.push(node.arguments[0].text);
  }
  if (ts.isFunctionDeclaration(node) && node.parameters[0]?.name.getText(ast).includes("apiManifest") &&
      node.parameters[0]?.name.getText(ast).includes("executeAgentCommand") &&
      node.parameters[0]?.name.getText(ast).includes("displayBridge")) factory = node.name?.text;
  ts.forEachChild(node, visit);
}
visit(ast);
if (!factory || commands.length < 40) throw new Error("Codex client format changed; inspect it before extracting.");
const serviceAst = ts.createSourceFile("service.mjs", service, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
let injected;
function findInjected(node) {
  if (ts.isStringLiteral(node) && node.text.startsWith("var PlaywrightInjected=")) injected = node.text;
  ts.forEachChild(node, findInjected);
}
findInjected(serviceAst);
if (!injected) throw new Error("The packaged Playwright DOM engine was not found.");
const exported = client.replace(/export\s*\{[^}]+\}\s*;?\s*$/, "") +
  `\nexport { ${factory} as createCodexBrowserClient };\nexport const commandContracts = [${commands.join(",")}];\n`;
const portable = await build({stdin:{contents:exported,loader:"js"},bundle:true,write:false,format:"esm",platform:"neutral",minify:true,drop:["console"],legalComments:"inline"});
await fs.mkdir(destination,{recursive:true});
await fs.writeFile(path.join(destination,"codex-browser-client.mjs"), portable.outputFiles[0].text);
const dom = await transform(injected,{loader:"js",minify:true,drop:["console"],legalComments:"inline"});
await fs.writeFile(path.join(destination,"playwright-injected.js"),dom.code);
const { commandContracts } = await import(pathToFileURL(path.join(destination,"codex-browser-client.mjs")).href);
function schema(value) {
  const d = value._def;
  switch(d.typeName) {
    case "ZodObject": {
      const shape = d.shape();
      const required = Object.keys(shape).filter(k=>!shape[k].isOptional());
      return {type:"object",properties:Object.fromEntries(Object.entries(shape).map(([k,v])=>[k,schema(v)])),...(required.length?{required}:{}),additionalProperties:d.unknownKeys==="passthrough"};
    }
    case "ZodString": return {type:"string",...Object.fromEntries((d.checks??[]).flatMap(c=>c.kind==="min"?[["minLength",c.value]]:c.kind==="max"?[["maxLength",c.value]]:[]))};
    case "ZodNumber": return {type:d.checks?.some(c=>c.kind==="int")?"integer":"number",...Object.fromEntries((d.checks??[]).flatMap(c=>c.kind==="min"?[[c.inclusive?"minimum":"exclusiveMinimum",c.value]]:c.kind==="max"?[[c.inclusive?"maximum":"exclusiveMaximum",c.value]]:[]))};
    case "ZodBoolean": return {type:"boolean"};
    case "ZodNull": return {type:"null"};
    case "ZodLiteral": return {const:d.value,type:typeof d.value};
    case "ZodEnum": return {type:"string",enum:d.values};
    case "ZodArray": return {type:"array",items:schema(d.type),...(d.minLength?{minItems:d.minLength.value}:{})};
    case "ZodTuple": return {type:"array",items:d.items.map(schema),minItems:d.items.length,maxItems:d.items.length};
    case "ZodUnion": return {anyOf:d.options.map(schema)};
    case "ZodIntersection": {
      const left=schema(d.left),right=schema(d.right);
      return left.type==="object"&&right.type==="object"?{type:"object",properties:{...left.properties,...right.properties},required:[...new Set([...(left.required??[]),...(right.required??[])])],additionalProperties:false}:{allOf:[left,right]};
    }
    case "ZodDiscriminatedUnion": return {anyOf:[...d.options.values()].map(schema)};
    case "ZodNullable": return {anyOf:[schema(d.innerType),{type:"null"}]};
    case "ZodOptional": case "ZodDefault": return schema(d.innerType);
    case "ZodEffects": return schema(d.schema);
    case "ZodRecord": return {type:"object",additionalProperties:schema(d.valueType)};
    case "ZodAny": case "ZodUnknown": return {};
    default: throw new Error(`Unmapped contract: ${d.typeName}`);
  }
}
const contracts = commandContracts.map(c=>({name:c.commandType,inputSchema:schema(c.PayloadSchema)}));
await fs.writeFile(path.join(destination,"command-contracts.json"),JSON.stringify(contracts,null,2)+"\n");
await fs.writeFile(path.join(destination,"api.json"),JSON.stringify(JSON.parse(apiText),null,2)+"\n");
await fs.writeFile(path.join(destination,"provenance.json"),JSON.stringify({
  product:"OpenAI Codex",version:JSON.parse(manifestText).version,
  sources:[{file:"scripts/browser-client.mjs",sha256:createHash("sha256").update(client).digest("hex")},{file:"scripts/browser-service.mjs",sha256:createHash("sha256").update(service).digest("hex")}],
  extraction:"Portable client and command schemas; embedded Playwright selector engine. Codex bootstrap replaced with BetterGravity transport. Console calls removed. No Codex service, telemetry, credentials, or native binaries included.",
  commandCount:contracts.length
},null,2)+"\n");
process.stdout.write(`Extracted ${contracts.length} browser command contracts, the client, and Playwright DOM engine.\n`);
