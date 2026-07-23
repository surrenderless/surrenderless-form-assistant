import type { AssistedFormPageData } from "@/lib/justice/realBbbBoundedSubmitLoop";

/**
 * Runs inside the FTC page. It records field metadata, sanitized current values for visible
 * text/textarea/select (inventory skip-when-satisfied), non-user radio/checkbox option values for
 * exact choice addressing, and actionable buttons only.
 */
export function collectOwnedFilingFtcPageDataInBrowser(): AssistedFormPageData {
  const sanitizeChoiceMetadata = (value: string | null | undefined): string =>
    (value ?? "").replace(/\s+/g, " ").trim().slice(0, 160);
  /** Live control values for inventory equality — capped; never logged in step diagnostics. */
  const sanitizeCurrentValue = (value: string | null | undefined): string =>
    (value ?? "").replace(/\s+/g, " ").trim().slice(0, 500);
  const accessibleChoiceName = (element: HTMLElement): string => {
    const ariaLabel = sanitizeChoiceMetadata(element.getAttribute("aria-label"));
    if (ariaLabel) return ariaLabel;
    const labelledBy = element.getAttribute("aria-labelledby")?.trim();
    if (labelledBy) {
      const label = labelledBy
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent ?? "")
        .join(" ");
      const sanitized = sanitizeChoiceMetadata(label);
      if (sanitized) return sanitized;
    }
    if (element.tagName.toLowerCase() === "input") {
      const input = element as HTMLInputElement;
      const label = sanitizeChoiceMetadata(
        Array.from(input.labels ?? []).map((entry) => entry.innerText).join(" ")
      );
      if (label) return label;
    }
    return sanitizeChoiceMetadata(element.textContent);
  };
  const fieldLabel = (field: Element): string => {
    const input = field as HTMLInputElement;
    const fromLabels = sanitizeChoiceMetadata(
      Array.from(input.labels ?? [])
        .map((entry) => entry.innerText)
        .join(" ")
    );
    if (fromLabels) return fromLabels;
    // Verified FTC /form/main comments textarea uses aria-labelledby without a <label>.
    return accessibleChoiceName(field as HTMLElement);
  };
  const elementIsVisible = (element: HTMLElement): boolean => {
    if (element.hidden) return false;
    const style = window.getComputedStyle(element);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.visibility === "collapse"
    ) {
      return false;
    }
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };

  const fields = Array.from(document.querySelectorAll("input, textarea, select"))
    .filter((field) => elementIsVisible(field as HTMLElement))
    .map((field) => {
      const input = field as HTMLInputElement;
      const tag = field.tagName.toLowerCase();
      const type = input.type || "";
      const formControlName = sanitizeChoiceMetadata(field.getAttribute("formcontrolname"));
      const isChoice = type === "radio" || type === "checkbox";
      const includeCurrentValue =
        !isChoice && (tag === "input" || tag === "textarea" || tag === "select");
      return {
        tag,
        type,
        name: field.getAttribute("name") || "",
        id: input.id || "",
        placeholder: field.getAttribute("placeholder") || "",
        label: fieldLabel(field),
        ...(formControlName ? { formControlName } : {}),
        ...(isChoice ? { optionValue: input.value } : {}),
        ...(includeCurrentValue ? { currentValue: sanitizeCurrentValue(input.value) } : {}),
      };
    });

  const choiceControls = Array.from(
    document.querySelectorAll<HTMLElement>(
      "input[type='radio'], input[type='checkbox'], [role='radio'], [role='checkbox']"
    )
  ).map((element) => {
    const isNative = element.tagName.toLowerCase() === "input";
    const input = element as HTMLInputElement;
    const nativeType = isNative ? input.type.toLowerCase() : "";
    const role = element.getAttribute("role")?.toLowerCase() ?? "";
    const kind: "radio" | "checkbox" =
      nativeType === "checkbox" || role === "checkbox"
        ? "checkbox"
        : "radio";
    const accessibleName = accessibleChoiceName(element);
    // FTC category/subcategory radios omit the value attribute; the JS property defaults to
    // "on" for every option, which is not a distinguishing locator key. Prefer accessibleName.
    const optionValue = sanitizeChoiceMetadata(
      isNative
        ? element.hasAttribute("value")
          ? input.value || accessibleName
          : accessibleName || input.value
        : element.getAttribute("data-value") ??
            element.getAttribute("value") ??
            accessibleName
    );
    return {
      source: isNative ? ("native" as const) : ("aria" as const),
      kind,
      name: sanitizeChoiceMetadata(element.getAttribute("name")),
      id: sanitizeChoiceMetadata(element.id),
      optionValue,
      accessibleName,
      visible: elementIsVisible(element),
      enabled:
        !(isNative && input.disabled) &&
        element.getAttribute("aria-disabled")?.toLowerCase() !== "true",
      checked: isNative
        ? Boolean(input.checked)
        : element.getAttribute("aria-checked")?.toLowerCase() === "true",
    };
  });

  const buttons = Array.from(
    document.querySelectorAll<HTMLElement>(
      // Verified FTC /form/main Continue is an <a role="button">, not a <button>.
      "button, input[type='submit'], a[role='button']"
    )
  )
    .filter((button) => {
      if (button.getAttribute("aria-disabled")?.toLowerCase() === "true") {
        return false;
      }
      const tag = button.tagName.toLowerCase();
      if (
        (tag === "button" || tag === "input") &&
        (button as HTMLButtonElement | HTMLInputElement).disabled
      ) {
        return false;
      }
      return elementIsVisible(button);
    })
    .map((button) => ({
      text:
        button.tagName.toLowerCase() === "input"
          ? (button as HTMLInputElement).value.trim()
          : button.textContent?.replace(/\u00a0/g, " ").trim() || "",
      id: button.id || "",
      name: button.getAttribute("name") || "",
      type: button.getAttribute("type") || button.getAttribute("role") || "",
    }));

  return {
    fields,
    choiceControls,
    buttons,
    url: window.location.href,
    pageText: document.body?.innerText?.slice(0, 8000) || "",
  };
}
