import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { applySourcePatches, readPatches } from "../src/main/source-patch.js";

const manifest = JSON.parse(readFileSync("community/plugins/gemini-app/plugin.json", "utf8"));
const patch = readPatches("gemini-app", manifest)!.patches.find(p => p.find === "Failed to get ARI for artifact:")!;

// Native component excerpts. Keeping their callbacks intact checks both the
// source guards and reuse across mounts, where React's local useMemo is empty.
const paletteSource = `var Mcb=()=>{var a=ZL();a=bz(a);var b=cl(a,nh),c=XM();return(0,z.useMemo)(()=>b?b.map(e=>{try{var f=EM(e.artifactAbsoluteUri,c)}catch{console.error("Failed to get ARI for artifact:",e.artifactAbsoluteUri);return}e=tA(vg(f.sourceUri));return{type:"basic",item:{id:f.sourceUri,label:f.displayName,icon:z.createElement(T,{name:e,className:"opacity-70 mx-0.5",size:16})}}}).filter(e=>e!==void 0):[],[b,c])};`;
const sectionSource = (name: string, title: string, excludeUploads: boolean) => `var ${name}=({collapsible:a,showCountBadge:b,cascadeId:c})=>{var e=yM();c=c??e;e=bz(c);var f=cl(e,nh),g=In(),h=(0,z.useMemo)(()=>{if(f)return[...f].filter(k=>!k.artifactAbsoluteUri.toLowerCase().endsWith(".pdf")).filter(k=>${excludeUploads ? "!" : ""}vg(k.artifactAbsoluteUri).path.includes("/.user_uploaded/")).sort((k,l)=>(l.lastEdited?qf(l.lastEdited).getTime():0)-(k.lastEdited?qf(k.lastEdited).getTime():0))},[f]);return c?z.createElement(J1,{title:"${title}",count:h?.length??0,collapsible:a,showCountBadge:b},k=>z.createElement(oLb,
{artifacts:h,reviewState:g,visibleCount:k${excludeUploads ? "" : ',emptyText:"No uploads"'}})):null};`;
const nativeSource = paletteSource + sectionSource("C3", "Artifacts", true) + sectionSource("BLb", "Uploads", false);

type Artifact = { artifactAbsoluteUri: string; lastEdited?: { seconds?: bigint; nanos?: number } | null };
type Node = { type: string; props: Record<string, unknown>; children: unknown[] };

function fixture(source = nativeSource) {
  const result = applySourcePatches(source, [{ pluginId: "gemini-app", patches: [patch] }]);
  if (source === nativeSource) expect(result.failures).toEqual([]);
  let list: Artifact[] | undefined = [];
  let workspace = "file:///workspace/";
  const parse = vi.fn((uri: string) => {
    if (uri === "invalid") throw new Error("invalid URI");
    return { path: new URL(uri).pathname };
  });
  const normalize = vi.fn((uri: string, base: string) => {
    if (uri === "invalid") throw new Error("invalid URI");
    const full = new URL(uri, base);
    return { sourceUri: full.href, displayName: full.pathname.slice(full.pathname.lastIndexOf("/") + 1) };
  });
  const createElement = (type: string, props: Record<string, unknown>, ...children: unknown[]) => ({ type, props, children });
  const error = vi.fn();
  const dependencies = {
    z: { useMemo: (build: () => unknown) => build(), createElement },
    ZL: () => "conversation", yM: () => "conversation", bz: (id: string) => id,
    cl: () => list, nh: {}, XM: () => workspace, In: () => "review-state",
    EM: normalize, vg: parse, tA: (uri: { path: string }) => uri.path.split(".").at(-1),
    T: "icon", J1: "section", oLb: "artifact-list",
    qf: (time: { seconds: bigint; nanos: number }) => new Date(Number(time.seconds) * 1000 + Math.round(time.nanos / 1e6)),
    console: { error }
  };
  const compile = (code: string) => new Function(...Object.keys(dependencies), `${code}\nreturn { palette: Mcb, artifacts: C3, uploads: BLb };`)(...Object.values(dependencies));
  const native = compile(nativeSource), candidate = compile(result.source);
  const render = (components: typeof native) => {
    const section = (component: (props: object) => Node) => {
      const node = component({ collapsible: true, showCountBadge: true });
      const child = (node.children[0] as (count: number) => Node)(3);
      return { ...node, children: [child] };
    };
    return { palette: components.palette(), artifacts: section(components.artifacts), uploads: section(components.uploads) };
  };
  return {
    candidate, native, result, parse, normalize, error,
    setList: (value: Artifact[] | undefined) => { list = value; },
    setWorkspace: (value: string) => { workspace = value; },
    render: () => render(candidate),
    compare: () => { const actual = render(candidate); expect(actual).toEqual(render(native)); return actual; }
  };
}

const row = (path: string, seconds = 0n, nanos = 0): Artifact => ({ artifactAbsoluteUri: `file:///workspace/${path}`, lastEdited: { seconds, nanos } });

describe("Gemini App artifact projection cache", () => {
  it("reuses unchanged projections across mounts with native ordering, counts, icons, and upload filtering", () => {
    const f = fixture();
    const list = [row("older.md", 1n), row(".user_uploaded/photo.png", 2n), row("hidden.PDF", 5n), row("newer.md", 4n), row("tie.md", 4n)];
    f.setList(list);
    const first = f.compare();
    f.parse.mockClear(); f.normalize.mockClear();
    expect(f.render()).toEqual(first);
    expect(f.normalize).not.toHaveBeenCalled();
    expect(f.parse).not.toHaveBeenCalled();
    expect(list.map(item => item.artifactAbsoluteUri)).toEqual(["older.md", ".user_uploaded/photo.png", "hidden.PDF", "newer.md", "tie.md"].map(path => `file:///workspace/${path}`));
  });

  it("refreshes for changed, replaced, inserted, removed, and reordered entries in the same array", () => {
    const f = fixture();
    const list = [row("a.md", 1n), row("b.md", 2n)];
    f.setList(list); f.compare();
    list[0]!.artifactAbsoluteUri = "file:///workspace/.user_uploaded/a.png"; f.compare();
    list[1] = row("replacement.md", 4n); f.compare();
    list.push(row("added.md", 4n)); f.compare();
    list.reverse(); f.compare();
    list.splice(1, 1); f.compare();
  });

  it("refreshes sort order for timestamp mutations, replacement, missing values, and empty timestamps", () => {
    const f = fixture();
    const list = [row("a.md", 1n), row("b.md", 1n)];
    f.setList(list); f.compare();
    list[0]!.lastEdited!.nanos = 500_000_000; f.compare();
    list[1]!.lastEdited!.seconds = 3n; f.compare();
    list[0]!.lastEdited = { seconds: 4n, nanos: 0 }; f.compare();
    delete list[0]!.lastEdited; f.compare();
    list[0]!.lastEdited = {}; f.compare();
    list[0]!.lastEdited = null; f.compare();
  });

  it("normalizes palette entries again when the workspace changes", () => {
    const f = fixture();
    f.setList([{ artifactAbsoluteUri: "./relative.md" }]);
    const first = f.candidate.palette();
    f.normalize.mockClear();
    expect(f.candidate.palette()).toBe(first);
    f.setWorkspace("file:///other-workspace/");
    const changed = f.candidate.palette();
    expect(changed).toEqual(f.native.palette());
    expect(changed[0].item.id).not.toEqual(first[0].item.id);
    expect(f.normalize).toHaveBeenCalled();
  });

  it("bounds each cache to four recent lists while keeping recently reused results", () => {
    const f = fixture();
    const lists = Array.from({ length: 5 }, (_, i) => [row(`item-${i}.md`)]);
    const render = (index: number) => { f.setList(lists[index]); return f.render(); };
    for (let i = 0; i < 4; i++) render(i);
    f.parse.mockClear(); f.normalize.mockClear();
    render(0); expect(f.normalize).not.toHaveBeenCalled(); expect(f.parse).not.toHaveBeenCalled();
    render(4);
    f.parse.mockClear(); f.normalize.mockClear();
    render(0); expect(f.normalize).not.toHaveBeenCalled(); expect(f.parse).not.toHaveBeenCalled();
    render(1); expect(f.normalize).toHaveBeenCalled(); expect(f.parse).toHaveBeenCalled();
  });

  it("keeps native invalid-entry errors and retries failed palette conversions", () => {
    const f = fixture();
    f.setList([{ artifactAbsoluteUri: "invalid" }]);
    expect(f.candidate.palette()).toEqual([]);
    expect(f.candidate.palette()).toEqual([]);
    expect(f.error).toHaveBeenCalledTimes(2);
    expect(() => f.candidate.artifacts({})).toThrow("invalid URI");
    expect(() => f.candidate.uploads({})).toThrow("invalid URI");
  });

  it("does not inspect accessors or reuse their values after a native callback", () => {
    const f = fixture();
    let uri = "file:///workspace/a.md";
    const getter = vi.fn(() => uri);
    const item = {} as Artifact;
    Object.defineProperty(item, "artifactAbsoluteUri", { get: getter, enumerable: true });
    f.setList([item]);
    const first = f.candidate.palette();
    expect(getter).toHaveBeenCalledTimes(1);
    uri = "file:///workspace/b.md";
    const second = f.candidate.palette();
    expect(getter).toHaveBeenCalledTimes(2);
    expect(second[0].item.id).not.toBe(first[0].item.id);
  });

  it("preserves empty and missing-list behavior", () => {
    const f = fixture();
    f.setList(undefined); f.compare();
    f.setList([]); f.compare(); f.compare();
  });

  it("keeps other replacements usable if a native component's version guard stops matching", () => {
    const source = nativeSource.replace('title:"Uploads"', 'title:"New Uploads"');
    const f = fixture(source);
    expect(f.result.failures).toHaveLength(1);
    f.setList([row("a.md"), row(".user_uploaded/b.md")]);
    f.render();
    f.normalize.mockClear();
    f.render();
    expect(f.normalize).not.toHaveBeenCalled();
  });

  it("matches renamed native symbols without changing the projection callback", () => {
    const renamed = nativeSource.replace(/\bMcb\b/g, "paletteHook").replace(/\bC3\b/g, "ArtifactSection").replace(/\bBLb\b/g, "UploadSection").replace(/\bz\b/g, "reactRuntime");
    const result = applySourcePatches(renamed, [{ pluginId: "gemini-app", patches: [patch] }]);
    expect(result.failures).toEqual([]);
    expect(() => new Function(result.source)).not.toThrow();
    expect(result.source).toContain("reactRuntime.useMemo");
  });
});
