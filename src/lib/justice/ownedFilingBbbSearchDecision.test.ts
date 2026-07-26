import { afterEach, describe, expect, it, vi } from "vitest";

import { classifyOwnedFilingClick } from "@/lib/justice/classifyOwnedFilingClick";
import { collectOwnedFilingBbbPageDataInBrowser } from "@/lib/justice/ownedFilingBbbPageData";
import {
  OWNED_FILING_BBB_SEARCH_DECISION_FAILURES,
  buildOwnedFilingBbbSearchDecision,
  isOwnedFilingBbbBusinessSearchUrl,
  isOwnedFilingBbbContinuationHrefAllowlisted,
  isOwnedFilingBbbWizardEntryLabel,
  normalizeBbbBusinessName,
  parseOwnedFilingBbbSearchFailureDetail,
} from "@/lib/justice/ownedFilingBbbSearchDecision";
import {
  buildButtonSelector,
  normalizeFormDecision,
  type AssistedFormBbbActionControl,
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

type ScrapedField = AssistedFormPageData["fields"][number];

/**
 * The BBB no-results Business Information form. `businessName` overrides the business-name control
 * (or drops it entirely when null) to exercise addressing and sequencing.
 */
function identityFields(
  businessName?: Partial<ScrapedField> | null
): AssistedFormPageData["fields"] {
  const nameControl: ScrapedField = {
    tag: "input",
    type: "text",
    name: "businessName",
    id: "",
    placeholder: "",
    label: "Business Name",
  };
  return [
    ...(businessName === null ? [] : [{ ...nameControl, ...businessName }]),
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

describe("isOwnedFilingBbbContinuationHrefAllowlisted", () => {
  it("allows empty, hash, and same-origin complaint paths", () => {
    expect(isOwnedFilingBbbContinuationHrefAllowlisted("")).toBe(true);
    expect(isOwnedFilingBbbContinuationHrefAllowlisted("#")).toBe(true);
    expect(isOwnedFilingBbbContinuationHrefAllowlisted("#business-info")).toBe(true);
    expect(isOwnedFilingBbbContinuationHrefAllowlisted("/file-a-complaint/search")).toBe(true);
    expect(isOwnedFilingBbbContinuationHrefAllowlisted("/complain/search")).toBe(true);
    expect(
      isOwnedFilingBbbContinuationHrefAllowlisted("https://www.bbb.org/file-a-complaint/search")
    ).toBe(true);
  });

  it("rejects external hosts and non-http schemes", () => {
    expect(isOwnedFilingBbbContinuationHrefAllowlisted("https://evil.example/x")).toBe(false);
    expect(isOwnedFilingBbbContinuationHrefAllowlisted("javascript:void(0)")).toBe(false);
    expect(isOwnedFilingBbbContinuationHrefAllowlisted("/business-information")).toBe(false);
  });
});

describe("isOwnedFilingBbbWizardEntryLabel", () => {
  it("matches only the two exact continuation labels", () => {
    expect(isOwnedFilingBbbWizardEntryLabel("File a Complaint")).toBe(true);
    expect(isOwnedFilingBbbWizardEntryLabel("Business Information Form")).toBe(true);
    expect(isOwnedFilingBbbWizardEntryLabel("Submit Complaint")).toBe(false);
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
      step: "select_result",
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
      step: "submit_business_form",
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

  it("fails closed before clicking when an identity control is ambiguous", () => {
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
    expect(decision).toEqual({
      ok: false,
      failure: "search_no_results_identity_incomplete",
      detail:
        "search_no_results_identity_incomplete results=0 matches=0 unaddressable=business_city",
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
      detail:
        "search_no_results_form_ambiguous results=0 matches=0 continuation_candidates=2 buttons=2 links=0",
    });
  });
});

describe("buildOwnedFilingBbbSearchDecision — no-results business-name addressing", () => {
  const proceedButton = { text: "File a Complaint", id: "", name: "", type: "button" };

  function businessNameSelector(fields: AssistedFormPageData["fields"]): string | undefined {
    const decision = buildOwnedFilingBbbSearchDecision(
      pageData({ bbbSearchResults: [], fields, buttons: [proceedButton] }),
      FULL_IDENTITY
    );
    if (!decision.ok) throw new Error(`expected a decision, got ${decision.detail}`);
    return decision.decision.fieldsToFill?.[0]?.selector;
  }

  it("addresses the nameless Angular control by formControlName", () => {
    expect(
      businessNameSelector(
        identityFields({ name: "", id: "", formControlName: "companyName", label: "Business name *" })
      )
    ).toBe("companyName");
  });

  it("falls back to id when the control has no name", () => {
    expect(businessNameSelector(identityFields({ name: "", id: "biz-name" }))).toBe("biz-name");
  });

  it("resolves the label through aria-label or placeholder", () => {
    expect(
      businessNameSelector(
        identityFields({ name: "", formControlName: "companyName", label: "", ariaLabel: "Business name" })
      )
    ).toBe("companyName");
    expect(
      businessNameSelector(
        identityFields({ name: "", formControlName: "companyName", label: "", placeholder: "Business Name" })
      )
    ).toBe("companyName");
  });

  it("accepts BBB label decoration and business-name synonyms without fuzzy matching", () => {
    for (const label of [
      "Business name:",
      "Business Name (required)",
      "Company name",
      "Business/Organization Name",
      "Name of business",
    ]) {
      expect(businessNameSelector(identityFields({ label }))).toBe("businessName");
    }
    // Not a business-name control: stays unmatched instead of being filled with the company name.
    const decision = buildOwnedFilingBbbSearchDecision(
      pageData({
        bbbSearchResults: [],
        fields: identityFields({ label: "Your name" }),
        buttons: [proceedButton],
      }),
      FULL_IDENTITY
    );
    expect(decision).toMatchObject({ ok: true, step: "reveal_business_form" });
  });

  it("prefers Business Information Form controls over search filters with the same wording", () => {
    const fields = [
      { tag: "input", type: "text", name: "find_text", id: "", placeholder: "Business Name", label: "" },
      ...identityFields({ name: "", formControlName: "companyName", label: "Business name" }).map(
        (field) => ({ ...field, inBusinessInfoForm: true })
      ),
    ];
    expect(businessNameSelector(fields)).toBe("companyName");
  });

  it("ignores BBB search filters that carry business-name wording, even unscoped", () => {
    const fields = [
      { tag: "input", type: "text", name: "find_text", id: "", placeholder: "Business Name", label: "Business Name" },
      { tag: "input", type: "text", name: "find_country", id: "", placeholder: "", label: "Country" },
      ...identityFields(),
    ];
    expect(businessNameSelector(fields)).toBe("businessName");
  });

  it("ignores hidden and disabled duplicates of the business form", () => {
    const fields = [
      ...identityFields(),
      { tag: "input", type: "text", name: "businessNameGhost", id: "", placeholder: "", label: "Business name", visible: false },
      { tag: "input", type: "text", name: "businessNameOff", id: "", placeholder: "", label: "Business name", enabled: false },
    ];
    expect(businessNameSelector(fields)).toBe("businessName");
  });

  it("fails closed when two visible controls both look like the business name", () => {
    const decision = buildOwnedFilingBbbSearchDecision(
      pageData({
        bbbSearchResults: [],
        fields: [
          ...identityFields(),
          { tag: "input", type: "text", name: "companyName", id: "", placeholder: "", label: "Company Name" },
        ],
        buttons: [proceedButton],
      }),
      FULL_IDENTITY
    );
    expect(decision).toEqual({
      ok: false,
      failure: "search_no_results_identity_incomplete",
      detail:
        "search_no_results_identity_incomplete results=0 matches=0 unaddressable=business_name",
    });
  });

  it("fails closed when the resolved key would match another control on the page", () => {
    const decision = buildOwnedFilingBbbSearchDecision(
      pageData({
        bbbSearchResults: [],
        fields: [
          ...identityFields({ name: "", formControlName: "companyName", label: "Business name" }),
          // A different visible control already answers to that key, so the fill selector is not unique.
          { tag: "input", type: "hidden", name: "companyName", id: "", placeholder: "", label: "" },
        ],
        buttons: [proceedButton],
      }),
      FULL_IDENTITY
    );
    expect(decision).toMatchObject({
      ok: false,
      detail:
        "search_no_results_identity_incomplete results=0 matches=0 unaddressable=business_name",
    });
  });
});

describe("buildOwnedFilingBbbSearchDecision — no-results sequencing", () => {
  function control(
    overrides: Partial<AssistedFormBbbActionControl> = {}
  ): AssistedFormBbbActionControl {
    return {
      kind: "button",
      text: "File a Complaint",
      id: "",
      name: "",
      href: "",
      visible: true,
      enabled: true,
      ...overrides,
    };
  }

  const ALL_IDENTITY_KEYS =
    "business_name,business_address,business_city,business_state,business_country,business_postal_code";

  it("prefers the explicit form opener over the wizard-entry CTA", () => {
    const decision = buildOwnedFilingBbbSearchDecision(
      pageData({
        bbbSearchResults: [],
        fields: [],
        bbbNoResultsControls: [control({ text: "Business Information Form" }), control()],
      }),
      FULL_IDENTITY
    );

    expect(decision).toMatchObject({
      ok: true,
      step: "reveal_business_form",
      decision: { nextButton: { selectorType: "text", value: "Business Information Form" } },
    });
  });

  it("reveals through the unique continuation control and fills nothing on that click", () => {
    const decision = buildOwnedFilingBbbSearchDecision(
      pageData({
        bbbSearchResults: [],
        fields: [],
        bbbNoResultsControls: [control({ text: "Business Information Form" })],
      }),
      FULL_IDENTITY
    );

    expect(decision).toEqual({
      ok: true,
      step: "reveal_business_form",
      decision: {
        fieldsToFill: [],
        nextButton: { selectorType: "text", value: "Business Information Form" },
        waitForNavigation: true,
      },
    });
    if (!decision.ok) throw new Error("expected a decision");
    expect(normalizeFormDecision(decision.decision)).toEqual(decision.decision);
    // Reversible reveal on the search step only.
    expect(classifyOwnedFilingClick(decision.decision.nextButton, { pageUrl: SEARCH_URL })).toBe(
      "safe"
    );
    expect(classifyOwnedFilingClick(decision.decision.nextButton)).toBe("unknown");
  });

  it("reveals through File a Complaint when there is no separate opener", () => {
    const decision = buildOwnedFilingBbbSearchDecision(
      pageData({ bbbSearchResults: [], fields: [], bbbNoResultsControls: [control()] }),
      FULL_IDENTITY
    );
    expect(decision).toMatchObject({
      ok: true,
      step: "reveal_business_form",
      decision: { fieldsToFill: [], nextButton: { selectorType: "text", value: "File a Complaint" } },
    });
  });

  it("never spends a second reveal click on a form that stayed unaddressable", () => {
    const decision = buildOwnedFilingBbbSearchDecision(
      pageData({ bbbSearchResults: [], fields: [], bbbNoResultsControls: [control()] }),
      FULL_IDENTITY,
      { revealAttempts: 1 }
    );
    expect(decision).toEqual({
      ok: false,
      failure: "search_no_results_identity_incomplete",
      detail: `search_no_results_identity_incomplete results=0 matches=0 unaddressable=${ALL_IDENTITY_KEYS}`,
    });
  });

  it("fails closed with sanitized counts on two genuinely distinct continuations", () => {
    const ambiguous = buildOwnedFilingBbbSearchDecision(
      pageData({
        bbbSearchResults: [],
        fields: [],
        bbbNoResultsControls: [control({ id: "cta-body" }), control({ id: "cta-other" })],
      }),
      FULL_IDENTITY
    );
    expect(ambiguous).toEqual({
      ok: false,
      failure: "search_no_results_form_ambiguous",
      detail: `search_no_results_form_ambiguous results=0 matches=0 continuation_candidates=2 buttons=2 links=0 unaddressable=${ALL_IDENTITY_KEYS}`,
    });
  });

  it("addresses a link continuation by unique id and keeps that click safe", () => {
    const decision = buildOwnedFilingBbbSearchDecision(
      pageData({
        bbbSearchResults: [],
        fields: [],
        bbbNoResultsControls: [
          control({ kind: "link", text: "Business Information Form", id: "biz-info-form" }),
        ],
      }),
      FULL_IDENTITY
    );

    expect(decision).toMatchObject({
      ok: true,
      step: "reveal_business_form",
      decision: {
        fieldsToFill: [],
        nextButton: { selectorType: "id", value: "biz-info-form" },
      },
    });
    if (!decision.ok) throw new Error("expected a decision");
    expect(normalizeFormDecision(decision.decision)).toEqual(decision.decision);
    expect(buildButtonSelector(decision.decision.nextButton!)).toBe("#biz-info-form");
  });

  it("addresses a link continuation by unique name when it has no id", () => {
    const decision = buildOwnedFilingBbbSearchDecision(
      pageData({
        bbbSearchResults: [],
        fields: [],
        bbbNoResultsControls: [control({ kind: "link", name: "bizInfoForm" })],
      }),
      FULL_IDENTITY
    );
    expect(decision).toMatchObject({
      ok: true,
      step: "reveal_business_form",
      decision: { nextButton: { selectorType: "name", value: "bizInfoForm" } },
    });
  });

  it("addresses a unique keyless link continuation by text when href is allowlisted", () => {
    const decision = buildOwnedFilingBbbSearchDecision(
      pageData({
        bbbSearchResults: [],
        fields: [],
        bbbNoResultsControls: [
          control({
            kind: "link",
            text: "Business Information Form",
            href: "/file-a-complaint/search",
          }),
        ],
      }),
      FULL_IDENTITY
    );

    expect(decision).toMatchObject({
      ok: true,
      step: "reveal_business_form",
      decision: {
        fieldsToFill: [],
        nextButton: { selectorType: "text", value: "Business Information Form" },
      },
    });
    if (!decision.ok) throw new Error("expected a decision");
    expect(normalizeFormDecision(decision.decision)).toEqual(decision.decision);
    expect(
      classifyOwnedFilingClick(decision.decision.nextButton, { pageUrl: SEARCH_URL })
    ).toBe("safe");
  });

  it("addresses a unique keyless link with empty href by text", () => {
    const decision = buildOwnedFilingBbbSearchDecision(
      pageData({
        bbbSearchResults: [],
        fields: [],
        bbbNoResultsControls: [control({ kind: "link", text: "File a Complaint", href: "" })],
      }),
      FULL_IDENTITY
    );
    expect(decision).toMatchObject({
      ok: true,
      step: "reveal_business_form",
      decision: { nextButton: { selectorType: "text", value: "File a Complaint" } },
    });
  });

  it("fails closed when the only continuation link has an off-allowlist href", () => {
    const external = buildOwnedFilingBbbSearchDecision(
      pageData({
        bbbSearchResults: [],
        fields: [],
        bbbNoResultsControls: [
          control({
            kind: "link",
            text: "Business Information Form",
            href: "https://evil.example/phish",
          }),
        ],
      }),
      FULL_IDENTITY
    );
    expect(external).toEqual({
      ok: false,
      failure: "search_no_results_form_ambiguous",
      detail: `search_no_results_form_ambiguous results=0 matches=0 continuation_candidates=1 buttons=0 links=1 unaddressable=${ALL_IDENTITY_KEYS}`,
    });

    const javascriptHref = buildOwnedFilingBbbSearchDecision(
      pageData({
        bbbSearchResults: [],
        fields: [],
        bbbNoResultsControls: [
          control({ kind: "link", text: "File a Complaint", href: "javascript:void(0)" }),
        ],
      }),
      FULL_IDENTITY
    );
    expect(javascriptHref).toMatchObject({ ok: false, failure: "search_no_results_form_ambiguous" });
  });

  it("requires approved values before any click, even when the form is missing", () => {
    const decision = buildOwnedFilingBbbSearchDecision(
      pageData({ bbbSearchResults: [], fields: [], bbbNoResultsControls: [control()] }),
      { business_name: "Fictional Digital Services" }
    );
    expect(decision).toMatchObject({
      ok: false,
      failure: "search_no_results_identity_incomplete",
      detail:
        "search_no_results_identity_incomplete results=0 matches=0 missing=business_address,business_city,business_state,business_country,business_postal_code unaddressable=business_name",
    });
  });

  it("fills and proceeds once the revealed form is uniquely addressable", () => {
    const decision = buildOwnedFilingBbbSearchDecision(
      pageData({
        bbbSearchResults: [],
        fields: identityFields({ name: "", formControlName: "companyName", label: "Business name *" }).map(
          (field) => ({ ...field, inBusinessInfoForm: true })
        ),
        bbbNoResultsControls: [control(), control({ visible: false })],
      }),
      FULL_IDENTITY,
      { revealAttempts: 1 }
    );

    expect(decision).toMatchObject({
      ok: true,
      step: "submit_business_form",
      decision: {
        fieldsToFill: [
          { selector: "companyName", value: "Fictional Digital Services" },
          { selector: "address", value: "1 Example Way" },
          { selector: "city", value: "Austin" },
          { selector: "state", value: "TX" },
          { selector: "country", value: "United States" },
          { selector: "postalCode", value: "78701" },
        ],
        nextButton: { selectorType: "text", value: "File a Complaint" },
      },
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
        "search_no_results_form_ambiguous results=0 matches=0 continuation_candidates=2 buttons=1 links=1"
      )
    ).toBe(
      "search_no_results_form_ambiguous results=0 matches=0 continuation_candidates=2 buttons=1 links=1"
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

  it("treats an id/name continuation as safe only when the scraped inventory verifies it", () => {
    const control = (
      overrides: Partial<AssistedFormBbbActionControl> = {}
    ): AssistedFormBbbActionControl => ({
      kind: "link",
      text: "Business Information Form",
      id: "biz-info-form",
      name: "",
      href: "/file-a-complaint/search",
      visible: true,
      enabled: true,
      ...overrides,
    });
    const button = { selectorType: "id" as const, value: "biz-info-form" };

    expect(
      classifyOwnedFilingClick(button, {
        pageUrl: SEARCH_URL,
        bbbContinuationControls: [control()],
      })
    ).toBe("safe");
    expect(
      classifyOwnedFilingClick(
        { selectorType: "name", value: "bizInfoForm" },
        {
          pageUrl: SEARCH_URL,
          bbbContinuationControls: [control({ id: "", name: "bizInfoForm" })],
        }
      )
    ).toBe("safe");

    // Unverifiable: no inventory, wrong label, hidden host, duplicate key, or off the search step.
    expect(classifyOwnedFilingClick(button, { pageUrl: SEARCH_URL })).toBe("unknown");
    expect(
      classifyOwnedFilingClick(button, {
        pageUrl: SEARCH_URL,
        bbbContinuationControls: [control({ text: "Submit Complaint" })],
      })
    ).toBe("unknown");
    expect(
      classifyOwnedFilingClick(button, {
        pageUrl: SEARCH_URL,
        bbbContinuationControls: [control({ visible: false })],
      })
    ).toBe("unknown");
    expect(
      classifyOwnedFilingClick(button, {
        pageUrl: SEARCH_URL,
        bbbContinuationControls: [control(), control()],
      })
    ).toBe("unknown");
    expect(
      classifyOwnedFilingClick(button, {
        pageUrl: "https://www.bbb.org/file-a-complaint/wizard/review",
        bbbContinuationControls: [control()],
      })
    ).toBe("unknown");
  });
});

/**
 * Minimal fake DOM. `environment: "node"` gives us no document, and only a handful of selector
 * shapes are used by the scrape, so a tiny matcher is enough to exercise it on realistic markup.
 */
type FakeEl = {
  tagName: string;
  attrs: Record<string, string>;
  textContent: string;
  visible: boolean;
  disabled: boolean;
  labels?: FakeEl[];
  parentElement: FakeEl | null;
  children: FakeEl[];
  id: string;
  type: string;
  getAttribute(name: string): string | null;
  getBoundingClientRect(): { width: number; height: number };
  querySelector(selector: string): FakeEl | null;
  querySelectorAll(selector: string): FakeEl[];
  closest(selector: string): FakeEl | null;
  contains(other: FakeEl): boolean;
  matches(selector: string): boolean;
};

function matchesSelector(node: FakeEl, selector: string): boolean {
  return selector.split(",").some((part) => {
    const simple = part.trim();
    const parsed = /^([a-z0-9]*)((?:\[[^\]]+\])*)$/i.exec(simple);
    if (!parsed) return false;
    const [, tag, rawAttrs] = parsed;
    if (tag && node.tagName.toLowerCase() !== tag.toLowerCase()) return false;
    const attrTests = rawAttrs.match(/\[[^\]]+\]/g) ?? [];
    return attrTests.every((attrTest) => {
      const body = attrTest.slice(1, -1);
      const withValue = /^([a-z0-9-]+)(\*?)=['"]?([^'"]*)['"]?$/i.exec(body);
      if (!withValue) return node.getAttribute(body) !== null;
      const [, name, operator, value] = withValue;
      const actual = node.getAttribute(name);
      if (actual === null) return false;
      return operator === "*" ? actual.includes(value) : actual === value;
    });
  });
}

function el(
  tag: string,
  options: {
    attrs?: Record<string, string>;
    text?: string;
    visible?: boolean;
    disabled?: boolean;
    children?: FakeEl[];
    labelled?: boolean;
  } = {}
): FakeEl {
  const attrs = options.attrs ?? {};
  const children = options.children ?? [];
  const descendants = (): FakeEl[] =>
    children.flatMap((child) => [child, ...child.querySelectorAll("*")]);
  const node: FakeEl = {
    tagName: tag.toUpperCase(),
    attrs,
    // Explicit text wins; otherwise a wrapper reports its descendants' text like a real node,
    // which is what makes one CTA match as several nested candidates.
    get textContent() {
      if (options.text !== undefined) return options.text;
      return children.map((child) => child.textContent).join(" ");
    },
    visible: options.visible !== false,
    disabled: options.disabled ?? false,
    parentElement: null,
    children,
    get id() {
      return attrs.id ?? "";
    },
    get type() {
      return attrs.type ?? "";
    },
    getAttribute: (name) => attrs[name.toLowerCase()] ?? null,
    getBoundingClientRect: () => ({
      width: node.visible ? 120 : 0,
      height: node.visible ? 24 : 0,
    }),
    querySelectorAll: (selector) =>
      selector === "*"
        ? descendants()
        : descendants().filter((child) => matchesSelector(child, selector)),
    querySelector: (selector) => node.querySelectorAll(selector)[0] ?? null,
    closest: (selector) => {
      let current: FakeEl | null = node;
      while (current) {
        if (matchesSelector(current, selector)) return current;
        current = current.parentElement;
      }
      return null;
    },
    contains: (other) => other === node || descendants().includes(other),
    matches: (selector) => matchesSelector(node, selector),
  };
  for (const child of children) child.parentElement = node;
  if (options.labelled) {
    const label = children.find((child) => child.tagName === "LABEL");
    const control = children.find((child) => child.tagName === "INPUT");
    if (label && control) control.labels = [label];
  }
  return node;
}

function installDom(root: FakeEl, pathname: string): void {
  const all = [root, ...root.querySelectorAll("*")];
  vi.stubGlobal("document", {
    body: { innerText: "no results available" },
    querySelectorAll: (selector: string) =>
      all.filter((node) => matchesSelector(node, selector)),
    querySelector: (selector: string) =>
      all.find((node) => matchesSelector(node, selector)) ?? null,
    getElementById: (id: string) => all.find((node) => node.attrs.id === id) ?? null,
  });
  vi.stubGlobal("window", {
    location: { pathname, href: `https://www.bbb.org${pathname}` },
    getComputedStyle: () => ({ display: "block", visibility: "visible", opacity: "1" }),
  });
}

/** Verified BBB no-results markup: Angular controls with no name/id, labelled by a sibling. */
function businessInformationForm(): FakeEl {
  const group = (label: string, control: FakeEl) =>
    el("div", { children: [el("label", { text: label }), control] });
  return el("form", {
    children: [
      el("h3", { text: "Enter Business Information" }),
      group("Business name *", el("input", { attrs: { formcontrolname: "companyName" } })),
      group("Address *", el("input", { attrs: { formcontrolname: "address" } })),
      group("City *", el("input", { attrs: { formcontrolname: "city" } })),
      group("State/Province *", el("select", { attrs: { formcontrolname: "state" } })),
      group("Country *", el("select", { attrs: { formcontrolname: "country" } })),
      group("Postal Code *", el("input", { attrs: { formcontrolname: "postalCode" } })),
      el("button", { text: "File a Complaint" }),
    ],
  });
}

describe("collectOwnedFilingBbbPageDataInBrowser", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("scrapes profile-link results with heading text on the search step", () => {
    installDom(
      el("div", {
        children: [
          el("a", {
            attrs: { id: "result-1", href: "/us/tx/austin/profile/x" },
            text: "  Fictional Digital\u00a0Services   A+ ",
            children: [el("h3", { text: "Fictional Digital Services" })],
          }),
          el("a", {
            attrs: { href: "/us/tx/austin/profile/y" },
            text: "Hidden Co",
            visible: false,
            children: [el("h3", { text: "Hidden Co" })],
          }),
        ],
      }),
      "/file-a-complaint/search"
    );

    expect(collectOwnedFilingBbbPageDataInBrowser().bbbSearchResults).toEqual([
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

  it("omits the search-step inventories on other steps", () => {
    installDom(businessInformationForm(), "/file-a-complaint");
    const data = collectOwnedFilingBbbPageDataInBrowser();
    expect(data.bbbSearchResults).toBeUndefined();
    expect(data.bbbNoResultsControls).toBeUndefined();
    expect(data.fields[0]?.inBusinessInfoForm).toBeUndefined();
  });

  it("keys nameless business-form controls and scopes them to the business form", () => {
    installDom(
      el("div", {
        children: [
          el("form", {
            children: [
              el("input", { attrs: { name: "find_text", placeholder: "Business Name" } }),
              el("button", { text: "Search" }),
            ],
          }),
          businessInformationForm(),
        ],
      }),
      "/file-a-complaint/search"
    );

    const data = collectOwnedFilingBbbPageDataInBrowser();
    expect(data.fields[0]).toMatchObject({
      name: "find_text",
      placeholder: "Business Name",
      visible: true,
      enabled: true,
    });
    expect(data.fields[0].inBusinessInfoForm).toBeUndefined();
    expect(data.fields[1]).toMatchObject({
      name: "",
      id: "",
      formControlName: "companyName",
      label: "Business name *",
      inBusinessInfoForm: true,
      visible: true,
      enabled: true,
    });
    expect(data.bbbNoResultsControls).toEqual([
      {
        kind: "button",
        text: "File a Complaint",
        id: "",
        name: "",
        href: "",
        visible: true,
        enabled: true,
      },
    ]);
    expect(data.buttons).toEqual([
      { text: "Search", id: "", name: "", type: "", visible: true, enabled: true },
      { text: "File a Complaint", id: "", name: "", type: "", visible: true, enabled: true },
    ]);
  });

  it("collapses nested and wrapper copies of one continuation into a single host", () => {
    installDom(
      el("main", {
        children: [
          el("p", { text: "No Results Available" }),
          // One CTA, three matching nodes: div wrapper > anchor > button.
          el("div", {
            children: [
              el("a", {
                attrs: { href: "/file-a-complaint/business-information" },
                children: [el("button", { attrs: { id: "biz-cta" }, text: "File a Complaint" })],
              }),
            ],
          }),
        ],
      }),
      "/file-a-complaint/search"
    );

    expect(collectOwnedFilingBbbPageDataInBrowser().bbbNoResultsControls).toEqual([
      {
        kind: "button",
        text: "File a Complaint",
        id: "biz-cta",
        name: "",
        href: "",
        visible: true,
        enabled: true,
      },
    ]);
  });

  it("keeps an anchor-only continuation addressable by id", () => {
    installDom(
      el("main", {
        children: [
          el("div", {
            children: [
              el("a", {
                attrs: { href: "/business-information", id: "biz-info-form" },
                text: "Business Information Form",
              }),
            ],
          }),
        ],
      }),
      "/file-a-complaint/search"
    );

    const data = collectOwnedFilingBbbPageDataInBrowser();
    expect(data.bbbNoResultsControls).toEqual([
      {
        kind: "link",
        text: "Business Information Form",
        id: "biz-info-form",
        name: "",
        href: "/business-information",
        visible: true,
        enabled: true,
      },
    ]);
    const decision = buildOwnedFilingBbbSearchDecision(data, FULL_IDENTITY);
    expect(decision).toMatchObject({
      ok: true,
      step: "reveal_business_form",
      decision: { nextButton: { selectorType: "id", value: "biz-info-form" } },
    });
    if (!decision.ok) throw new Error("expected a decision");
    expect(
      classifyOwnedFilingClick(decision.decision.nextButton, {
        pageUrl: SEARCH_URL,
        bbbContinuationControls: data.bbbNoResultsControls,
      })
    ).toBe("safe");
  });

  it("addresses a bare keyless anchor continuation by text after scrape", () => {
    installDom(
      el("main", {
        children: [
          el("a", {
            attrs: { href: "/file-a-complaint/search#business-info" },
            text: "Business Information Form",
          }),
        ],
      }),
      "/file-a-complaint/search"
    );

    const data = collectOwnedFilingBbbPageDataInBrowser();
    expect(data.bbbNoResultsControls).toEqual([
      {
        kind: "link",
        text: "Business Information Form",
        id: "",
        name: "",
        href: "/file-a-complaint/search#business-info",
        visible: true,
        enabled: true,
      },
    ]);
    expect(buildOwnedFilingBbbSearchDecision(data, FULL_IDENTITY)).toMatchObject({
      ok: true,
      step: "reveal_business_form",
      decision: { nextButton: { selectorType: "text", value: "Business Information Form" } },
    });
  });

  it("excludes site chrome so a header CTA cannot create ambiguity", () => {
    installDom(
      el("div", {
        children: [
          el("header", {
            children: [
              el("a", { attrs: { href: "/complain", id: "nav-cta" }, text: "File a Complaint" }),
            ],
          }),
          el("nav", {
            children: [
              el("a", { attrs: { href: "/complain", id: "nav-2" }, text: "File a Complaint" }),
            ],
          }),
          el("main", {
            children: [el("button", { attrs: { id: "body-cta" }, text: "File a Complaint" })],
          }),
          el("footer", {
            children: [
              el("a", { attrs: { href: "/complain", id: "foot-cta" }, text: "File a Complaint" }),
            ],
          }),
        ],
      }),
      "/file-a-complaint/search"
    );

    expect(collectOwnedFilingBbbPageDataInBrowser().bbbNoResultsControls).toEqual([
      {
        kind: "button",
        text: "File a Complaint",
        id: "body-cta",
        name: "",
        href: "",
        visible: true,
        enabled: true,
      },
    ]);
  });

  it("drops hidden and disabled continuation hosts", () => {
    installDom(
      el("main", {
        children: [
          el("button", { attrs: { id: "visible-cta" }, text: "File a Complaint" }),
          el("button", { attrs: { id: "hidden-cta" }, text: "File a Complaint", visible: false }),
          el("button", {
            attrs: { id: "disabled-cta", "aria-disabled": "true" },
            text: "File a Complaint",
          }),
        ],
      }),
      "/file-a-complaint/search"
    );

    expect(
      collectOwnedFilingBbbPageDataInBrowser().bbbNoResultsControls?.map((c) => c.id)
    ).toEqual(["visible-cta"]);
  });

  it("keeps two genuinely distinct continuations separate", () => {
    installDom(
      el("main", {
        children: [
          el("button", { attrs: { id: "cta-a" }, text: "File a Complaint" }),
          el("button", { attrs: { id: "cta-b" }, text: "File a Complaint" }),
        ],
      }),
      "/file-a-complaint/search"
    );

    const data = collectOwnedFilingBbbPageDataInBrowser();
    expect(data.bbbNoResultsControls?.map((c) => c.id)).toEqual(["cta-a", "cta-b"]);
    expect(buildOwnedFilingBbbSearchDecision(data, FULL_IDENTITY)).toMatchObject({
      ok: false,
      failure: "search_no_results_form_ambiguous",
      detail:
        "search_no_results_form_ambiguous results=0 matches=0 continuation_candidates=2 buttons=2 links=0 unaddressable=business_name,business_address,business_city,business_state,business_country,business_postal_code",
    });
  });

  it("resolves labels from aria-label, an associated label, and aria-labelledby", () => {
    installDom(
      el("div", {
        children: [
          el("input", { attrs: { name: "aria", "aria-label": "Business name" } }),
          el("div", {
            labelled: true,
            children: [
              el("label", { attrs: { id: "lbl-city", for: "city" }, text: "City" }),
              el("input", { attrs: { id: "city", name: "city" } }),
            ],
          }),
          el("div", {
            children: [
              el("span", { attrs: { id: "postal-hint" }, text: "Postal Code" }),
              el("input", { attrs: { name: "postal", "aria-labelledby": "postal-hint" } }),
            ],
          }),
        ],
      }),
      "/file-a-complaint/search"
    );

    const data = collectOwnedFilingBbbPageDataInBrowser();
    expect(data.fields.map((field) => field.label)).toEqual([
      "Business name",
      "City",
      "Postal Code",
    ]);
    expect(data.fields[0].ariaLabel).toBe("Business name");
  });

  it("never lets a control inherit a sibling control's label", () => {
    installDom(
      el("div", {
        children: [
          el("div", {
            children: [
              el("label", { text: "City" }),
              el("input", { attrs: { name: "a" } }),
              el("input", { attrs: { name: "b" } }),
            ],
          }),
        ],
      }),
      "/file-a-complaint/search"
    );
    expect(collectOwnedFilingBbbPageDataInBrowser().fields.map((f) => f.label)).toEqual(["", ""]);
  });

  it("feeds a fill-ready decision for the real no-results markup", () => {
    installDom(businessInformationForm(), "/file-a-complaint/search");
    const decision = buildOwnedFilingBbbSearchDecision(
      collectOwnedFilingBbbPageDataInBrowser(),
      FULL_IDENTITY
    );

    expect(decision).toMatchObject({
      ok: true,
      step: "submit_business_form",
      decision: {
        fieldsToFill: [
          { selector: "companyName", value: "Fictional Digital Services" },
          { selector: "address", value: "1 Example Way" },
          { selector: "city", value: "Austin" },
          { selector: "state", value: "TX" },
          { selector: "country", value: "United States" },
          { selector: "postalCode", value: "78701" },
        ],
        nextButton: { selectorType: "text", value: "File a Complaint" },
      },
    });
  });
});
