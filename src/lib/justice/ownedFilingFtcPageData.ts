import type { AssistedFormPageData } from "@/lib/justice/realBbbBoundedSubmitLoop";

/**
 * Runs inside the FTC page. It intentionally records field metadata only (never values) and
 * exposes only buttons that are currently enabled and visibly actionable.
 */
export function collectOwnedFilingFtcPageDataInBrowser(): AssistedFormPageData {
  const fields = Array.from(document.querySelectorAll("input, textarea, select")).map((field) => {
    const input = field as HTMLInputElement;
    const label = input.labels?.[0]?.innerText || "";
    return {
      tag: field.tagName.toLowerCase(),
      type: input.type || "",
      name: field.getAttribute("name") || "",
      id: input.id || "",
      placeholder: field.getAttribute("placeholder") || "",
      label,
    };
  });

  const buttons = Array.from(
    document.querySelectorAll<HTMLButtonElement | HTMLInputElement>(
      "button, input[type='submit']"
    )
  )
    .filter((button) => {
      if (button.disabled || button.getAttribute("aria-disabled")?.toLowerCase() === "true") {
        return false;
      }
      if (button.hidden) return false;
      const style = window.getComputedStyle(button);
      if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") {
        return false;
      }
      const rect = button.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    })
    .map((button) => ({
      text:
        button.tagName.toLowerCase() === "input"
          ? (button as HTMLInputElement).value.trim()
          : button.textContent?.trim() || "",
      id: button.id || "",
      name: button.getAttribute("name") || "",
      type: button.getAttribute("type") || "",
    }));

  return {
    fields,
    buttons,
    url: window.location.href,
    pageText: document.body?.innerText?.slice(0, 8000) || "",
  };
}
