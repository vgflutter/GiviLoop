import type { Locator } from "playwright";
import { BrowserRunError } from "./browser-runtime.js";

// Hidden Chrome targets on Windows/Linux can acknowledge CDP keyboard events
// without delivering them after a renderer change. Use the page's editing
// command and DOM activation instead. Never alter event trust or page scripts.
export async function fillWindowlessInput(input: Locator, text: string): Promise<void> {
  const filled = await input.evaluate((node, value) => {
    if (!(node instanceof HTMLElement) || !node.isConnected || node.closest('[inert]')) return false;
    const field = node instanceof HTMLTextAreaElement || node instanceof HTMLInputElement;
    if (field ? node.disabled || node.readOnly : !node.isContentEditable) return false;
    node.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
    const box = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    if (!box.width || !box.height || style.visibility !== "visible" || style.display === "none") return false;
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    if (!hit || !node.contains(hit)) return false;
    node.focus();
    if (field) node.select();
    else {
      const range = document.createRange(); range.selectNodeContents(node);
      const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
    }
    // Native insertText creates block wrappers for blank lines in a rich-text
    // editor. Insert escaped text + explicit breaks so code whitespace survives.
    const html = value.replace(/\r\n?/g, "\n").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("\n", "<br>");
    const inserted = document.execCommand(field ? "insertText" : "insertHTML", false, field ? value : html);
    const actual = field ? node.value : node.innerText;
    return inserted && actual.replace(/\r\n?/g, "\n") === value.replace(/\r\n?/g, "\n");
  }, text);
  if (!filled) throw new BrowserRunError("BROWSER_INTERACTION_REQUIRED",
    "The windowless composer did not confirm the complete request. Use givi resume --foreground. No prompt was sent.");
}

export async function activateWindowlessControl(control: Locator, enter: boolean, choice = false): Promise<void> {
  const activated = await control.evaluate((node, { useEnter, allowChoice }) => {
    if (!(node instanceof HTMLElement) || !node.isConnected || node.closest('[inert]') ||
        node.getAttribute("aria-disabled") === "true" || node.matches(":disabled")) return false;
    node.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
    const box = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    if (!box.width || !box.height || style.visibility !== "visible" || style.display === "none") return false;
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    if (!hit || !node.contains(hit)) return false;
    if (useEnter) {
      node.focus();
      node.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, bubbles: true, cancelable: true }));
      node.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", keyCode: 13, bubbles: true, cancelable: true }));
    } else {
      if (!(node instanceof HTMLButtonElement || node instanceof HTMLInputElement && ["button", "submit"].includes(node.type)) &&
          !(allowChoice && ["menuitem", "menuitemradio", "option"].includes(node.getAttribute("role") ?? ""))) return false;
      node.click();
    }
    return true;
  }, { useEnter: enter, allowChoice: choice });
  if (!activated) throw new BrowserRunError("BROWSER_INTERACTION_REQUIRED", "The windowless control is unavailable or covered. Use givi resume --foreground.");
}
