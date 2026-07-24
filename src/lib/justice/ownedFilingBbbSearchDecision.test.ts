import { afterEach, describe, expect, it, vi } from "vitest";

import { classifyOwnedFilingClick } from "@/lib/justice/classifyOwnedFilingClick";
import { collectOwnedFilingBbbPageDataInBrowser } from "@/lib/justice/ownedFilingBbbPageData";
import {
  OWNED_FILING_BBB_SEARCH_DECISION_FAILURES,
  buildOwnedFilingBbbSearchDecision,
  isOwnedFilingBbbBusinessSearchUrl,
  normalizeBbbBusinessName,
  parseOwnedFilingBbbSearchFailureDetail,
} from "@/lib/justice/ownedFilingBbbSearchDecision";
import {
  buildButtonSelector,
  normalizeFormDecision,
  type AssistedFormBbbSearchResult,
  type AssistedFormPageData,
} from "@/lib/justice/realBbbBoundedSubmitLoop";

const SEARCH_URL =
  "https://www.bbb.org/file-a-complaint/search?find_country=USA&find_text=Fictional%20Digital%20Services&page=1&touched=1";

function result(
  overrides: Partial<AssistedFormBbbSearchResult> = {}
): AssistedFormBbbSearchResult {
  return {
    kind: "link",
    text: "",
    headingText: "",
    id: "",
    name: "",
    visible: true,
    enabled: true,
    ...overrides,
  };
}

function pageData(overrides: Partial<AssistedFormPageData> = {}): AssistedFormPageData {
  return {
    fields: [],
    buttons: [],
    url: SEARCH_URL,
    ...overrides,
  };
}

function identityFields(): AssistedFormPageData["fields"] {
  return [
    { tag: "input", type: "text", name: "businessName", id: "", placeholder: "", label: "Business Name" },
    { tag: "input", type: "text", name: "address", id: "", placeholder: "", label: "Address" },
    { tag: "input", type: "text", name: "city", id: "", placeholder: "", label: "City" },
    { tag: "select", type: "select-one", name: "state", id: "", placeholder: "", label: "State/Province" },
    { tag: "select", type: "select-one", name: "country", id: "", placeholder: "", label: "Country" },
    { tag: "input", type: "text", name: "postalCode", id: "", placeholder: "", label: "Postal Code" },
    { tag: "input", type: "text", name: "phone", id: "", placeholder: "", label: "Phone number (optional)" },
    { tag: "input", type: "email", name: "businessEmail", id: "", placeholder: "", label: "Business email (optional)" },
    { tag: "input", type: "url", name: "url", id: "", placeholder: "", label: "URL (optional)" },
  ];
}

const FULL_IDENTITY = {
  business_name: "Fictional Digital Services",
  business_address: "1 Example Way",
  business_city: "Austin",
  business_state: "TX",
  business_country: "United States",
  business_postal_code: "78701",
};

describe("isOwnedFilingBbbBusinessSearchUrl", () => {
  it("matches the live complaint search step regardless of query string", () => {
    expect(isOwnedFilingBbbBusinessSearchUrl(SEARCH_URL)).toBe(true);
    expect(isOwnedFilingBbbBusinessSearchUrl("https://www.bbb.org/file-a-complaint/search/")).toBe(
      true
    );
    expect(isOwnedFilingBbbBusinessSearchUrl("https://www.bbb.org/complain/search")).toBe(true);
  });

  it("does not match other steps, other hosts, or unparsable urls", () => {
    expect(isOwnedFilingBbbBusinessSearchUrl("https://www.bbb.org/file-a-complaint")).toBe(false);
    expect(
      isOwnedFilingBbbBusinessSearchUrl("https://www.bbb.org/file-a-complaint/wizard/review")
    ).toBe(false);
    expect(isOwnedFilingBbbBusinessSearchUrl("https://evil.test/file-a-complaint/search")).toBe(
      false
    );
    expect(isOwnedFilingBbbBusinessSearchUrl("")).toBe(false);
    expect(isOwnedFilingBbbBusinessSearchUrl("not a url")).toBe(false);
  });
});

describe("normalizeBbbBusinessName", () => {
  it("normalizes case and whitespace only", () => {
    expect(normalizeBbbBusinessName("  Fictional   Digital\u00a0Services. ")).toBe(
      "fictional digital services"
    );
    // Punctuation differences stay distinct — matching is never fuzzy.
    expect(normalizeBbbBusinessName("Acme, Inc")).not.toBe(normalizeBbbBusinessName("Acme Inc"));
  });
});

describe("buildOwnedFilingBbbSearchDecision — result selection", () => {
  it("selects the single exact match by unique id and fills nothing", () => {
    const decision = buildOwnedFilingBbbSearchDecision(
      pageData({
        bbbSearchResults: [
          result({ id: "result-1", headingText: "Fictional Digital Services" }),
          result({ id: "result-2", headingText: "Other Digital Services" }),
        ],
      }),
      { business_name: "Fictional Digital Services" }
    );

    expect(decision).toEqual({
      ok: true,
      decision: {
        fieldsToFill: [],
        nextButton: { selectorType: "id", value: "result-1" },
        waitForNavigation: true,
      },
    });
  });

  it("emits a schema-valid decision that normalizeFormDecision and buildButtonSelector accept", () => {
    const decision = buildOwnedFilingBbbSearchDecision(
      pageData({ bbbSearchResults: [result({ id: "result-1", headingText: "Fictional Digital Services" })] }),
      { business_name: "fictional digital services" }
    );
    if (!decision.ok) throw new Error("expected a decision");

    expect(normalizeFormDecision(decision.decision)).toEqual(decision.decision);
    expect(buildButtonSelector(decision.decision.nextButton!)).toBe("#result-1");
  });

  it("uses the heading name rather than the whole card text", () => {
    const decision = buildOwnedFilingBbbSearchDecision(
      pageData({
        bbbSearchResults: [
          result({
            id: "result-1",
            headingText: "Fictional Digital Services",
            text: "Fictional Digital Services A+ Rating 1 Example Way Austin TX",
          }),
        ],
      }),
      { business_name: "Fictional Digital Services" }
    );
    expect(decision.ok).toBe(true);
  });

  it("addresses a button-kind result by exact text when it has no id or name", () => {
    const decision = buildOwnedFilingBbbSearchDecision(
      pageData({
        bbbSearchResults: [
          result({ kind: "button", headingText: "Fictional Digital Services" }),
          result({ kind: "button", headingText: "Other Digital Services" }),
        ],
      }),
      { business_name: "Fictional Digital Services" }
    );
    if (!decision.ok) throw new Error("expected a decision");
    expect(decision.decision.nextButton).toEqual({
      selectorType: "text",
      value: "Fictional Digital Services",
    });
  });

  it("fails closed when the only match is a link with no id or name", () => {
    // text selectors resolve to button:has-text(...) — a bare link is not addressable.
    const decision = buildOwnedFilingBbbSearchDecision(
      pageData({ bbbSearchResults: [result({ headingText: "Fictional Digital Services" })] }),
      { business_name: "Fictional Digital Services" }
    );
    expect(decision).toEqual({
      ok: false,
      failure: "search_result_unaddressable",
      detail: "search_result_unaddressable results=1 matches=1",
    });
  });

  it("fails closed on two same-named results instead of guessing", () => {
    const decision = buildOwnedFilingBbbSearchDecision(
      pageData({
        bbbSearchResults: [
          result({ id: "result-1", headingText: "Fictional Digital Services" }),
          result({ id: "result-2", headingText: "Fictional Digital Services" }),
          result({ id: "result-3", headingText: "Unrelated LLC" }),
        ],
      }),
      { business_name: "Fictional Digital Services" }
    );
    expect(decision).toEqual({
      ok: false,
      failure: "search_result_ambiguous",
      detail: "search_result_ambiguous results=3 matches=2",
    });
  });

  it("never substitutes a different real business when nothing matches exactly", () => {
    const decision = buildOwnedFilingBbbSearchDecision(
      pageData({
        bbbSearchResults: [
          result({ id: "result-1", headingText: "Fictional Digital Service" }),
          result({ id: "result-2", headingText: "Fictional Digital Services LLC" }),
        ],
      }),
      { business_name: "Fictional Digital Services" }
    );
    expect(decision).toEqual({
      ok: false,
      failure: "search_result_unmatched",
      detail: "search_result_unmatched results=2 matches=0",
    });
  });

  it("ignores hidden and disabled results so they cannot create ambiguity", () => {
    const decision = buildOwnedFilingBbbSearchDecision(
      pageData({
        bbbSearchResults: [
          result({ id: "result-1", headingText: "Fictional Digital Services" }),
          result({ id: "result-2", headingText: "Fictional Digital Services", visible: false }),
          result({ id: "result-3", headingText: "Fictional Digital Services", enabled: false }),
        ],
      }),
      { business_name: "Fictional Digital Services" }
    );
    if (!decision.ok) throw new Error("expected a decision");
    expect(decision.decision.nextButton).toEqual({ selectorType: "id", value: "result-1" });
  });

  it("fails closed when intake carries no business name", () => {
    const decision = buildOwnedFilingBbbSearchDecision(
      pageData({ bbbSearchResults: [result({ id: "result-1", headingText: "Anything" })] }),
      { business_name: "   " }
    );
    expect(decision).toEqual({
      ok: false,
      failure: "search_business_name_missing",
      detail: "search_business_name_missing results=1 matches=0 missing=business_name",
    });
  });
});

describe("buildOwnedFilingBbbSearchDecision — no results", () => {
  it("reproduces the production zero-result run: intake lacks business address, so fail closed", () => {
    const decision = buildOwnedFilingBbbSearchDecision(
      pageData({ bbbSearchResults: [], fields: identityFields() }),
      { business_name: "Fictional Digital Services" }
    );
    expect(decision).toEqual({
      ok: false,
      failure: "search_no_results_identity_incomplete",
      detail:
        "search_no_results_identity_incomplete results=0 matches=0 missing=business_address,business_city,business_state,business_country,business_postal_code",
    });
  });

  it("names only allowlisted missing keys when postal identity is incomplete", () => {
    const decision = buildOwnedFilingBbbSearchDecision(
      pageData({ bbbSearchResults: [], fields: identityFields() }),
      {
        business_name: "Fictional Digital Services",
        business_address: "1 Example Way",
        business_city: "Austin",
      }
    );
    expect(decision).toEqual({
      ok: false,
      failure: "search_no_results_identity_incomplete",
      detail:
        "search_no_results_identity_incomplete results=0 matches=0 missing=business_state,business_country,business_postal_code",
    });
  });

  it("takes the Business Information Form path when identity is complete and uniquely actionable", () => {
    const decision = buildOwnedFilingBbbSearchDecision(
      pageData({
        bbbSearchResults: [],
        fields: identityFields(),
        buttons: [
          { text: "Search", id: "", name: "", type: "button" },
          { text: "File a Complaint", id: "", name: "", type: "button" },
        ],
      }),
      FULL_IDENTITY
    );

    expect(decision).toEqual({
      ok: true,
      decision: {
        fieldsToFill: [
          { selector: "businessName", value: "Fictional Digital Services" },
          { selector: "address", value: "1 Example Way" },
          { selector: "city", value: "Austin" },
          { selector: "state", value: "TX" },
          { selector: "country", value: "United States" },
          { selector: "postalCode", value: "78701" },
        ],
        nextButton: { selectorType: "text", value: "File a Complaint" },
        waitForNavigation: true,
      },
    });
    if (!decision.ok) throw new Error("expected a decision");
    expect(normalizeFormDecision(decision.decision)).toEqual(decision.decision);
  });

  it("also fills approved optional website and business email when uniquely addressable", () => {
    const decision = buildOwnedFilingBbbSearchDecision(
      pageData({
        bbbSearchResults: [],
        fields: identityFields(),
        buttons: [{ text: "File a Complaint", id: "", name: "", type: "button" }],
      }),
      {
        ...FULL_IDENTITY,
        business_website: "https://fictional.example",
        business_email: "help@example.invalid",
      }
    );
    if (!decision.ok) throw new Error("expected a decision");
    expect(decision.decision.fieldsToFill).toEqual(
      expect.arrayContaining([
        { selector: "url", value: "https://fictional.example" },
        { selector: "businessEmail", value: "help@example.invalid" },
      ])
    );
  });

  it("does not invent postal identity from consumer_us_state", () => {
    const decision = buildOwnedFilingBbbSearchDecision(
      pageData({ bbbSearchResults: [], fields: identityFields() }),
      {
        business_name: "Fictional Digital Services",
        consumer_us_state: "TX",
      }
    );
    expect(decision).toMatchObject({
      ok: false,
      failure: "search_no_results_identity_incomplete",
    });
    if (decision.ok) throw new Error("expected a failure");
    expect(decision.detail).toContain("missing=business_address");
    expect(decision.detail).not.toContain("consumer_us_state");
  });

  it("fails closed when an identity field is not uniquely resolvable", () => {
    const decision = buildOwnedFilingBbbSearchDecision(
      pageData({
        bbbSearchResults: [],
        fields: [
          ...identityFields(),
          { tag: "input", type: "text", name: "city2", id: "", placeholder: "", label: "City" },
        ],
        buttons: [{ text: "File a Complaint", id: "", name: "", type: "button" }],
      }),
      FULL_IDENTITY
    );
    expect(decision).toMatchObject({
      ok: false,
      failure: "search_no_results_identity_incomplete",
      detail:
        "search_no_results_identity_incomplete results=0 matches=0 missing=business_city",
    });
  });

  it("fails closed when the proceed control is not uniquely actionable", () => {
    const decision = buildOwnedFilingBbbSearchDecision(
      pageData({
        bbbSearchResults: [],
        fields: identityFields(),
        buttons: [
          { text: "File a Complaint", id: "", name: "", type: "button" },
          { text: "File a Complaint", id: "", name: "", type: "button" },
        ],
      }),
      FULL_IDENTITY
    );
    expect(decision).toEqual({
      ok: false,
      failure: "search_no_results_form_ambiguous",
      detail: "search_no_results_form_ambiguous results=0 matches=0",
    });
  });
});

describe("parseOwnedFilingBbbSearchFailureDetail", () => {
  it("passes through allowlisted enums with counts", () => {
    expect(parseOwnedFilingBbbSearchFailureDetail("search_result_ambiguous results=3 matches=2")).toBe(
      "search_result_ambiguous results=3 matches=2"
    );
    expect(
      parseOwnedFilingBbbSearchFailureDetail(
        "search_no_results_identity_incomplete results=0 matches=0 missing=business_address,business_city"
      )
    ).toBe(
      "search_no_results_identity_incomplete results=0 matches=0 missing=business_address,business_city"
    );
  });

  it("rejects anything outside the allowlist so model text never reaches notes", () => {
    expect(parseOwnedFilingBbbSearchFailureDetail(undefined)).toBeNull();
    expect(parseOwnedFilingBbbSearchFailureDetail("text:Submit Complaint")).toBeNull();
    expect(
      parseOwnedFilingBbbSearchFailureDetail("decide-action returned {action: click_result}")
    ).toBeNull();
  });

  it("keeps every emitted failure inside the allowlist", () => {
    const emitted = buildOwnedFilingBbbSearchDecision(pageData(), {});
    if (emitted.ok) throw new Error("expected a failure");
    expect(OWNED_FILING_BBB_SEARCH_DECISION_FAILURES.has(emitted.failure)).toBe(true);
  });
});

describe("classifyOwnedFilingClick — BBB search wizard entry", () => {
  it("treats File a Complaint as safe only on the business-search step", () => {
    const button = { selectorType: "text" as const, value: "File a Complaint" };
    expect(classifyOwnedFilingClick(button, { pageUrl: SEARCH_URL })).toBe("safe");
    expect(classifyOwnedFilingClick(button)).toBe("irreversible");
    expect(
      classifyOwnedFilingClick(button, {
        pageUrl: "https://www.bbb.org/file-a-complaint/wizard/review",
      })
    ).toBe("irreversible");
  });

  it("keeps true submit gates irreversible on the search step", () => {
    for (const value of ["Submit", "Submit Complaint", "File Complaint", "Send Complaint"]) {
      expect(
        classifyOwnedFilingClick({ selectorType: "text", value }, { pageUrl: SEARCH_URL })
      ).toBe("irreversible");
    }
    expect(
      classifyOwnedFilingClick({ selectorType: "type", value: "submit" }, { pageUrl: SEARCH_URL })
    ).toBe("irreversible");
  });
});

describe("collectOwnedFilingBbbPageDataInBrowser", () => {
  type FakeEl = {
    tagName: string;
    id: string;
    disabled: boolean;
    attributes: Record<string, string>;
    textContent: string;
    heading: string | null;
    visible: boolean;
    getAttribute(name: string): string | null;
    querySelector(selector: string): { textContent: string } | null;
    getBoundingClientRect(): { width: number; height: number };
  };

  function anchor(overrides: Partial<FakeEl> = {}): FakeEl {
    const node: FakeEl = {
      tagName: "A",
      id: "",
      disabled: false,
      attributes: {},
      textContent: "",
      heading: null,
      visible: true,
      getAttribute: (name: string) => node.attributes[name] ?? null,
      querySelector: () => (node.heading === null ? null : { textContent: node.heading }),
      getBoundingClientRect: () => ({
        width: node.visible ? 200 : 0,
        height: node.visible ? 40 : 0,
      }),
      ...overrides,
    };
    return node;
  }

  function installDom(results: FakeEl[], pathname: string): void {
    vi.stubGlobal("document", {
      body: { innerText: "search results" },
      querySelectorAll(selector: string) {
        if (selector === "input, textarea, select") return [];
        if (selector === "button, input[type='submit']") return [];
        return results;
      },
    });
    vi.stubGlobal("window", {
      location: { pathname, href: `https://www.bbb.org${pathname}` },
      getComputedStyle: () => ({ display: "block", visibility: "visible", opacity: "1" }),
    });
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("scrapes profile-link results with heading text on the search step", () => {
    installDom(
      [
        anchor({
          id: "result-1",
          textContent: "  Fictional Digital\u00a0Services   A+ ",
          heading: "Fictional Digital Services",
        }),
        anchor({ textContent: "Hidden Co", heading: "Hidden Co", visible: false }),
      ],
      "/file-a-complaint/search"
    );

    const data = collectOwnedFilingBbbPageDataInBrowser();
    expect(data.bbbSearchResults).toEqual([
      {
        kind: "link",
        text: "Fictional Digital Services A+",
        headingText: "Fictional Digital Services",
        id: "result-1",
        name: "",
        visible: true,
        enabled: true,
      },
      {
        kind: "link",
        text: "Hidden Co",
        headingText: "Hidden Co",
        id: "",
        name: "",
        visible: false,
        enabled: true,
      },
    ]);
  });

  it("omits the result inventory on non-search steps", () => {
    installDom([anchor({ textContent: "Fictional Digital Services" })], "/file-a-complaint");
    expect(collectOwnedFilingBbbPageDataInBrowser().bbbSearchResults).toBeUndefined();
  });
});
