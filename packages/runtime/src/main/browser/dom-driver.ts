/** Runs in an isolated Chromium world with Codex's extracted Playwright engine. */
export async function browserDomDriver(input: Record<string, any>): Promise<any> {
  const engine = (globalThis as any).__bgBrowserInjected;
  if (!engine) throw new Error("Browser selector engine is not ready.");
  const selector = String(input.selector ?? "");
  const all = () => engine.querySelectorAll(engine.parseSelector(selector), document) as HTMLElement[];
  const one = () => {
    const matches = all();
    if (matches.length !== 1) throw new Error(`Expected one element for ${selector}; found ${matches.length}.`);
    return matches[0]!;
  };
  const visible = (element: Element) => {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && getComputedStyle(element).visibility !== "hidden" && getComputedStyle(element).display !== "none";
  };
  const describe = (element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    let generated = "";
    try { generated = engine.generateSelector(element, { testIdAttributeName: "data-testid" }).selector; } catch { generated = element.id ? `#${CSS.escape(element.id)}` : element.tagName.toLowerCase(); }
    const style = getComputedStyle(element);
    return {
      tagName: element.tagName.toLowerCase(), role: element.getAttribute("role"),
      visibleText: (element.innerText ?? "").slice(0, 1000), ariaName: element.getAttribute("aria-label"), testId: element.getAttribute("data-testid"),
      boundingBox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      preview: element.outerHTML.slice(0, 1500), selector: { primary: generated, candidates: [generated] },
      styles: { color: style.color, backgroundColor: style.backgroundColor, fontSize: style.fontSize, fontFamily: style.fontFamily, fontWeight: style.fontWeight, padding: style.padding, margin: style.margin, borderRadius: style.borderRadius }
    };
  };
  switch (input.action) {
    case "snapshot": return engine.ariaSnapshot(document.body ?? document.documentElement, { mode: "ai" });
    case "count": return all().length;
    case "visible": return all().some(visible);
    case "enabled": return engine.elementState(one(), "enabled").matches;
    case "text": return input.all ? all().map(el => el.textContent ?? "") : one().textContent;
    case "innerText": return one().innerText;
    case "attribute": return one().getAttribute(String(input.name));
    case "readAll": return all().map(el => {
      const target = input.relative_selector ? engine.querySelector(engine.parseSelector(input.relative_selector), el) : el;
      return target ? { attributes: Object.fromEntries([...target.attributes].map((a: any) => [a.name, a.value])), inner_text: target.innerText ?? "", text_content: target.textContent } : null;
    });
    case "bounds": {
      const element = one();
      element.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
      if (!input.force) {
        const result = await engine.checkElementStates(element, ["visible", "enabled", "stable"]);
        if (result) throw new Error(`Element is not ready: ${result.missingState ?? result.error ?? "detached"}.`);
      }
      const rect = element.getBoundingClientRect();
      const x = Math.max(0, Math.min(innerWidth - 1, rect.x + rect.width / 2));
      const y = Math.max(0, Math.min(innerHeight - 1, rect.y + rect.height / 2));
      if (!input.force) {
        const hit = document.elementFromPoint(x, y);
        if (hit && hit !== element && !element.contains(hit) && !hit.contains(element)) throw new Error("Another element intercepts this click.");
      }
      return { x, y, ...describe(element) };
    }
    case "focus": one().focus(); return true;
    case "fill": {
      const element = one();
      if ((element as HTMLInputElement).type === "file") throw new Error("Choose files manually in the browser.");
      return engine.fill(element, String(input.value));
    }
    case "select": return engine.selectOptions(one(), input.selections);
    case "checked": return engine.elementState(one(), "checked").matches;
    case "info": {
      const element = document.elementFromPoint(Number(input.x), Number(input.y));
      return element ? [describe(element as HTMLElement)] : [];
    }
    case "describe": return describe(one());
    case "html": return document.documentElement.outerHTML;
    case "evaluate": {
      const target = input.all ? all() : one();
      const fn = (0, eval)(`(${String(input.script)})`);
      if (typeof fn !== "function") throw new Error("Locator evaluation requires a function.");
      return await fn(target);
    }
    case "pageText": return document.body?.innerText ?? "";
    case "selection": {
      const element = one();
      const text = String(input.text);
      if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
        const index = element.value.indexOf(text);
        if (index < 0) throw new Error("Text was not found in the selected element.");
        element.focus();
        element.setSelectionRange(index, index + text.length);
        return true;
      }
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const index = (node.textContent ?? "").indexOf(text);
        if (index < 0) continue;
        const range = document.createRange();
        range.setStart(node, index); range.setEnd(node, index + text.length);
        if (input.selection_type === "cursor_before") range.collapse(true);
        if (input.selection_type === "cursor_after") range.collapse(false);
        getSelection()?.removeAllRanges(); getSelection()?.addRange(range);
        return true;
      }
      throw new Error("Text was not found in the selected element.");
    }
    case "styles": {
      const element = one();
      const allowed = new Set(["color", "backgroundColor", "fontSize", "fontFamily", "fontWeight", "padding", "margin", "borderRadius", "width", "height", "gap", "lineHeight"]);
      const original = element.getAttribute("style");
      for (const [name, value] of Object.entries(input.styles ?? {})) if (allowed.has(name) && typeof value === "string" && !/url\s*\(/i.test(value)) (element.style as any)[name] = value;
      return { original, ...describe(element) };
    }
    case "restoreStyle": {
      const element = one();
      if (input.original === null) element.removeAttribute("style"); else element.setAttribute("style", String(input.original));
      return true;
    }
    case "media": {
      const element = selector ? one() : document.elementFromPoint(Number(input.x), Number(input.y));
      if (!element) throw new Error("No media at that location.");
      const media = element.closest("a[href],img,video,audio,source") ?? element;
      const url = (media as HTMLMediaElement).currentSrc || media.getAttribute("src") || media.getAttribute("href");
      if (!url) throw new Error("No downloadable media was found.");
      return new URL(url, location.href).href;
    }
    default: throw new Error("Unknown browser DOM action.");
  }
}

export function annotationScript(binding: string): string {
  return `(() => {
    globalThis.__bgBrowserAnnotationStop?.();
    const box = document.createElement('div');
    box.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;border:2px solid #88b5ff;background:#88b5ff18;border-radius:3px;display:none';
    document.documentElement.appendChild(box);
    let start = null;
    const rect = r => { box.style.display='block'; Object.assign(box.style,{left:r.x+'px',top:r.y+'px',width:r.width+'px',height:r.height+'px'}); };
    const move = e => { if(start) rect({x:Math.min(start.x,e.clientX),y:Math.min(start.y,e.clientY),width:Math.abs(e.clientX-start.x),height:Math.abs(e.clientY-start.y)}); else if(e.target instanceof Element) rect(e.target.getBoundingClientRect()); };
    const down = e => { e.preventDefault(); e.stopImmediatePropagation(); start={x:e.clientX,y:e.clientY}; };
    const up = e => {
      e.preventDefault(); e.stopImmediatePropagation();
      const area = start && (Math.abs(e.clientX-start.x)>8 || Math.abs(e.clientY-start.y)>8) ? {x:Math.min(start.x,e.clientX),y:Math.min(start.y,e.clientY),width:Math.abs(e.clientX-start.x),height:Math.abs(e.clientY-start.y)} : null;
      box.remove();
      const el=document.elementFromPoint(e.clientX,e.clientY);
      const selected=el?(${browserDomDriver.toString()})({action:'info',x:e.clientX,y:e.clientY}):Promise.resolve([]);
      selected.then(items => globalThis[${JSON.stringify(binding)}](JSON.stringify({url:location.href,title:document.title,area,element:items[0]??null})));
      stop();
    };
    const click = e => { e.preventDefault(); e.stopImmediatePropagation(); };
    const key = e => { if(e.key==='Escape') stop(); };
    const stop = () => { box.remove(); document.removeEventListener('pointermove',move,true); document.removeEventListener('pointerdown',down,true); document.removeEventListener('pointerup',up,true); document.removeEventListener('click',click,true); document.removeEventListener('keydown',key,true); delete globalThis.__bgBrowserAnnotationStop; };
    document.addEventListener('pointermove',move,true); document.addEventListener('pointerdown',down,true); document.addEventListener('pointerup',up,true); document.addEventListener('click',click,true); document.addEventListener('keydown',key,true);
    globalThis.__bgBrowserAnnotationStop=stop;
  })()`;
}
