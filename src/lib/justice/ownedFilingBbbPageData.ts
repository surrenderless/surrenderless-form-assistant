import type {
  AssistedFormBbbSearchResult,
  AssistedFormPageData,
} from "@/lib/justice/realBbbBoundedSubmitLoop";

/**
 * Runs inside the page. Scrapes the legacy BBB field/button corpus plus, on the complaint
 * search step only, the actionable business-result candidates the deterministic search handler
 * needs (the generic decide-action scrape saw no results at all and invented actions).
 */
export function collectOwnedFilingBbbPageDataInBrowser(): AssistedFormPageData {
  const collapse = (value: string | null | undefined): string =>
    (value ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();

  const fields = Array.from(document.querySelectorAll("input, textarea, select")).map((field) => {
    const label = (field as HTMLInputElement).labels?.[0]?.innerText || "";
    return {
      tag: field.tagName.toLowerCase(),
      type: (field as HTMLInputElement).type || "",
      name: field.getAttribute("name") || "",
      id: (field as HTMLInputElement).id || "",
      placeholder: field.getAttribute("placeholder") || "",
      label,
    };
  });

  const buttons = Array.from(document.querySelectorAll("button, input[type='submit']")).map(
    (btn) => ({
      text: btn.textContent?.trim() || "",
      id: (btn as HTMLElement).id || "",
      name: btn.getAttribute("name") || "",
      type: btn.getAttribute("type") || "",
    })
  );

  const isSearchStep = /^\/(file-a-complaint|complain)\/search\/?$/i.test(
    window.location.pathname
  );

  let bbbSearchResults: AssistedFormBbbSearchResult[] | undefined;
  if (isSearchStep) {
    const isVisible = (el: Element): boolean => {
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return false;
      const style = window.getComputedStyle(el);
      return (
        style.visibility !== "hidden" &&
        style.display !== "none" &&
        Number(style.opacity || "1") > 0
      );
    };
    const isEnabled = (el: Element): boolean =>
      !(el as HTMLButtonElement).disabled && el.getAttribute("aria-disabled") !== "true";

    // Verified BBB markup: each search hit links to a business profile page.
    const candidates = Array.from(
      document.querySelectorAll("a[href*='/profile/'], button[data-business-name]")
    );
    bbbSearchResults = candidates.map((el) => {
      const heading = el.querySelector("h2, h3, h4, strong");
      return {
        kind: el.tagName.toLowerCase() === "a" ? ("link" as const) : ("button" as const),
        text: collapse(el.textContent).slice(0, 160),
        headingText: collapse(
          heading?.textContent ||
            el.getAttribute("aria-label") ||
            el.getAttribute("data-business-name")
        ).slice(0, 160),
        id: (el as HTMLElement).id || "",
        name: el.getAttribute("name") || "",
        visible: isVisible(el),
        enabled: isEnabled(el),
      };
    });
  }

  return {
    fields,
    buttons,
    url: window.location.href,
    pageText: document.body?.innerText?.slice(0, 8000) || "",
    ...(bbbSearchResults ? { bbbSearchResults } : {}),
  };
}
