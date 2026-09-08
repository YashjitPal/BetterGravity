// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

const source = readFileSync("community/plugins/gemini-app/index.js", "utf8");
const handler = source.slice(
  source.indexOf("function handleNewConversationActivation("),
  source.indexOf("function checkUrlForProjectSwitch(")
);

function createHandler() {
  const navigate = vi.fn();
  const markExperience = vi.fn();
  const store = vi.fn();
  const activate = new Function(
    "navigateToExperienceNewConversation", "getStoredExperience", "markExperience", "setStoredExperience",
    `${handler}\nreturn handleNewConversationActivation;`
  )(navigate, () => "work", markExperience, store) as (event: unknown) => void;
  return { activate, navigate, markExperience, store };
}

afterEach(() => {
  document.body.innerHTML = "";
  document.documentElement.removeAttribute("data-gemini-experience");
});

describe("Gemini App new-conversation routing", () => {
  it("uses the selected experience for ordinary New Conversation clicks", () => {
    const { activate, navigate, markExperience } = createHandler();
    activate(new MouseEvent("click", { cancelable: true }));
    expect(navigate).toHaveBeenCalledExactlyOnceWith("work");
    expect(markExperience).not.toHaveBeenCalled();
  });

  // React wraps the pet's DOM click. Ignoring its explicit scope sent quick chat
  // into the last project whenever Work was the selected experience.
  it("routes a pet quick chat to Conversations through React's nativeEvent", () => {
    document.body.innerHTML = '<div id="gemini-experience-switch"></div>';
    const { activate, navigate, markExperience } = createHandler();
    const nativeEvent = new MouseEvent("click", { cancelable: true });
    Object.defineProperty(nativeEvent, "betterGravityProjectless", { value: true });
    activate({ nativeEvent, preventDefault: vi.fn(), stopPropagation: vi.fn() });
    expect(markExperience).toHaveBeenCalledExactlyOnceWith(document.querySelector("#gemini-experience-switch"), "chat", true);
    expect(navigate).toHaveBeenCalledExactlyOnceWith("chat");
  });

  it("remembers Chat when the experience switch has not mounted yet", () => {
    const { activate, navigate, store } = createHandler();
    const event = new MouseEvent("click", { cancelable: true });
    Object.defineProperty(event, "betterGravityProjectless", { value: true });
    activate(event);
    expect(store).toHaveBeenCalledExactlyOnceWith("chat");
    expect(document.documentElement.getAttribute("data-gemini-experience")).toBe("chat");
    expect(navigate).toHaveBeenCalledExactlyOnceWith("chat");
  });
});
