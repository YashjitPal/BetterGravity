type Attributes = Record<string, string | number | boolean | undefined>;

type Child = Node | string | undefined | false;

/**
 * Small element builder, so UI code reads as structure rather than plumbing.
 *
 * `text` sets textContent and `html` sets innerHTML; the latter is only used for
 * inline icons defined in this package, never for anything user-supplied.
 */
export function el<Tag extends keyof HTMLElementTagNameMap>(
  tag: Tag,
  attributes: Attributes = {},
  children: readonly Child[] = []
): HTMLElementTagNameMap[Tag] {
  const element = document.createElement(tag);

  for (const [name, value] of Object.entries(attributes)) {
    if (value === undefined) continue;
    // ARIA state is three-valued: "false" has to be written, unlike boolean
    // HTML attributes such as `selected`, where absence is the false state.
    const isAriaState = name.startsWith("aria-");
    if (value === false && !isAriaState) continue;
    if (name === "class") element.className = String(value);
    else if (name === "text") element.textContent = String(value);
    else if (name === "html") element.innerHTML = String(value);
    else element.setAttribute(name, String(value));
  }

  for (const child of children) {
    if (!child) continue;
    element.append(typeof child === "string" ? document.createTextNode(child) : child);
  }

  return element;
}
