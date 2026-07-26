import type {
  AssistedFormBbbActionControl,
  AssistedFormBbbSearchResult,
  AssistedFormPageData,
} from "@/lib/justice/realBbbBoundedSubmitLoop";

/**
 * Runs inside the page. Scrapes the legacy BBB field/button corpus plus, on the complaint
 * search step only, the actionable business-result candidates and the no-results continuation
 * controls the deterministic search handler needs (the generic decide-action scrape saw no
 * results at all and invented actions).
 */
export function collectOwnedFilingBbbPageDataInBrowser(): AssistedFormPageData {
  const collapse = (value: string | null | undefined): string =>
    (value ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();

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

  const isSearchStep = /^\/(file-a-complaint|complain)\/search\/?$/i.test(
    window.location.pathname
  );

  /**
   * BBB Angular controls frequently have no associated <label> and no name/id, so the label is
   * resolved through the accessibility chain. The container fallback only accepts a wrapper that
   * holds exactly one label and one control, so a control can never inherit a sibling's label.
   */
  const resolveLabel = (field: Element): string => {
    const input = field as HTMLInputElement;
    const direct = collapse(input.labels?.[0]?.innerText || input.labels?.[0]?.textContent);
    if (direct) return direct;
    const labelledBy = field.getAttribute("aria-labelledby");
    if (labelledBy) {
      const parts = labelledBy
        .split(/\s+/)
        .map((id) => collapse(document.getElementById(id)?.textContent))
        .filter(Boolean);
      if (parts.length > 0) return parts.join(" ");
    }
    const wrapping = field.closest?.("label");
    if (wrapping) {
      const wrappingText = collapse(wrapping.textContent);
      if (wrappingText) return wrappingText;
    }
    let node = field.parentElement;
    let depth = 0;
    while (node && depth < 3) {
      const labels = node.querySelectorAll("label");
      const controls = node.querySelectorAll("input, textarea, select");
      if (labels.length === 1 && controls.length === 1) {
        const text = collapse(labels[0].textContent);
        if (text) return text;
      }
      node = node.parentElement;
      depth += 1;
    }
    return "";
  };

  /**
   * True when the control belongs to the no-results "Enter Business Information" section, which
   * lets the search step address that form's controls without competing with search filters.
   */
  const inBusinessInfoForm = (field: Element): boolean => {
    let node = field.parentElement;
    let depth = 0;
    while (node && depth < 8) {
      const tag = node.tagName.toLowerCase();
      if (tag === "form" || tag === "fieldset" || tag === "section") {
        const headed = Array.from(node.querySelectorAll("h1, h2, h3, h4, h5, legend")).some((el) =>
          /business\s+information/i.test(collapse(el.textContent))
        );
        const hasWizardEntry = Array.from(
          node.querySelectorAll("button, input[type='submit']")
        ).some((el) =>
          /^file\s+a\s+complaint$/i.test(
            collapse(el.textContent || el.getAttribute("value"))
          )
        );
        if (headed || hasWizardEntry) return true;
      }
      node = node.parentElement;
      depth += 1;
    }
    return false;
  };

  const fields = Array.from(document.querySelectorAll("input, textarea, select")).map((field) => {
    const ariaLabel = collapse(field.getAttribute("aria-label"));
    const formControlName = field.getAttribute("formcontrolname") || "";
    return {
      tag: field.tagName.toLowerCase(),
      type: (field as HTMLInputElement).type || "",
      name: field.getAttribute("name") || "",
      id: (field as HTMLInputElement).id || "",
      placeholder: field.getAttribute("placeholder") || "",
      label: resolveLabel(field) || ariaLabel,
      visible: isVisible(field),
      enabled: isEnabled(field),
      ...(ariaLabel ? { ariaLabel } : {}),
      ...(formControlName ? { formControlName } : {}),
      ...(isSearchStep && inBusinessInfoForm(field) ? { inBusinessInfoForm: true } : {}),
    };
  });

  const buttons = Array.from(document.querySelectorAll("button, input[type='submit']")).map(
    (btn) => ({
      text: btn.textContent?.trim() || "",
      id: (btn as HTMLElement).id || "",
      name: btn.getAttribute("name") || "",
      type: btn.getAttribute("type") || "",
      visible: isVisible(btn),
      enabled: isEnabled(btn),
    })
  );

  let bbbSearchResults: AssistedFormBbbSearchResult[] | undefined;
  let bbbNoResultsControls: AssistedFormBbbActionControl[] | undefined;
  if (isSearchStep) {
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

    // Allowlisted no-results continuation labels only — never an arbitrary control corpus.
    // The live CTA renders as nested wrappers (e.g. `a > button`, `div > a`) whose text is each
    // exactly the label, so raw node matching over-counts one semantic continuation. Collapse
    // ancestor/descendant chains to the innermost actionable host, exactly like the goal picker.
    const continuationPattern = /^(file\s+a\s+complaint|business\s+information\s+form)$/i;
    const actionableSelector = 'button, input[type="submit"], a[href], [role="button"]';
    const continuationScopeSelector = `${actionableSelector}, div, span, li, p, h1, h2, h3, h4`;
    const chromeSelector =
      'header, nav, footer, [role="banner"], [role="navigation"], [role="contentinfo"]';

    const labelCandidates = (el: Element): string[] => [
      collapse(el.textContent),
      collapse(el.getAttribute("value")),
    ];
    const matchedLabel = (el: Element): string =>
      labelCandidates(el).find((text) => text && continuationPattern.test(text)) ?? "";
    const wraps = (outer: Element, inner: Element): boolean =>
      outer !== inner && typeof outer.contains === "function" && outer.contains(inner);

    const labelMatches = Array.from(
      document.querySelectorAll(continuationScopeSelector)
    ).filter((el) => matchedLabel(el).length > 0);
    const roots = labelMatches.filter((el) => !labelMatches.some((other) => wraps(other, el)));
    const hosts = roots.map((root) => {
      const chain = labelMatches.filter((el) => el === root || wraps(root, el));
      const actionable = chain.filter(
        (el) => typeof el.matches === "function" && el.matches(actionableSelector)
      );
      return actionable.length > 0 ? actionable[actionable.length - 1] : root;
    });

    // Site-wide "File a Complaint" chrome must never compete with the no-results continuation.
    const contentHosts = hosts
      .filter((host, index) => hosts.indexOf(host) === index)
      .filter((host) => !(typeof host.closest === "function" && host.closest(chromeSelector)));
    const mainRegion = document.querySelector('main, [role="main"]');
    const scopedHosts = mainRegion
      ? contentHosts.filter((host) => mainRegion.contains(host))
      : contentHosts;

    bbbNoResultsControls = (scopedHosts.length > 0 ? scopedHosts : contentHosts)
      .filter((host) => isVisible(host) && isEnabled(host))
      .map((el) => ({
        // Real <button> is text-addressable; an anchor may be too when it is the unique
        // allowlisted continuation (apply resolves button|link by accessible name).
        kind: el.tagName.toLowerCase() === "button" ? ("button" as const) : ("link" as const),
        text: matchedLabel(el),
        id: (el as HTMLElement).id || "",
        name: el.getAttribute("name") || "",
        href: el.getAttribute("href") || "",
        visible: true,
        enabled: true,
      }));
  }

  return {
    fields,
    buttons,
    url: window.location.href,
    pageText: document.body?.innerText?.slice(0, 8000) || "",
    ...(bbbSearchResults ? { bbbSearchResults } : {}),
    ...(bbbNoResultsControls ? { bbbNoResultsControls } : {}),
  };
}
