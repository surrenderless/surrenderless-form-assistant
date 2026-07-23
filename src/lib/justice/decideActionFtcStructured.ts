/**
 * FTC-only decide-action contracts and boundary adapters.
 *
 * - `ftc_structured`: /assistant ambiguous subcategory — single radio object (no arrays),
 *   strict json_schema.
 * - `ftc_form_main`: /form/main — multi-field FormDecision via json_object (variable optional
 *   field metadata is not safely expressible under strict schema without unsupported
 *   array-length keywords); normalizeFormDecision + apply remain fail-closed.
 */

/** Request body mode for FTC /assistant structured single-radio decisions. */
export const DECIDE_ACTION_FTC_MODE = "ftc_structured";

/** Request body mode for FTC /form/main multi-field decisions. */
export const DECIDE_ACTION_FTC_FORM_MAIN_MODE = "ftc_form_main";

/**
 * External FTC /assistant response contract (no arrays). Mapped at the API boundary to the
 * internal FormDecision shape: fieldsToFill: [fieldToFill].
 */
export const FTC_STRUCTURED_DECISION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["fieldToFill", "nextButton"],
  properties: {
    fieldToFill: {
      type: "object",
      additionalProperties: false,
      required: ["selector", "value", "controlKind", "choiceSelectorType"],
      properties: {
        selector: { type: "string" },
        value: { type: "string" },
        controlKind: { type: "string", enum: ["radio"] },
        choiceSelectorType: { type: "string", enum: ["id"] },
      },
    },
    nextButton: {
      type: "object",
      additionalProperties: false,
      required: ["value", "selectorType"],
      properties: {
        value: { type: "string" },
        selectorType: { type: "string" },
      },
    },
  },
} as const;

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

/**
 * Maps the external FTC single-object contract to the internal FormDecision shape.
 * Rejects missing/extra/invalid properties without echoing payload contents.
 */
export function adaptFtcStructuredDecision(parsed: unknown): {
  fieldsToFill: Array<{
    selector: string;
    value: string;
    controlKind: "radio";
    choiceSelectorType: "id";
  }>;
  nextButton: { value: string; selectorType: string };
} | null {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const root = parsed as Record<string, unknown>;
  if (!hasOnlyKeys(root, ["fieldToFill", "nextButton"])) return null;

  const fieldToFill = root.fieldToFill;
  const nextButton = root.nextButton;
  if (!fieldToFill || typeof fieldToFill !== "object" || Array.isArray(fieldToFill)) return null;
  if (!nextButton || typeof nextButton !== "object" || Array.isArray(nextButton)) return null;

  const field = fieldToFill as Record<string, unknown>;
  const next = nextButton as Record<string, unknown>;
  if (!hasOnlyKeys(field, ["selector", "value", "controlKind", "choiceSelectorType"])) return null;
  if (!hasOnlyKeys(next, ["value", "selectorType"])) return null;

  if (typeof field.selector !== "string" || typeof field.value !== "string") return null;
  if (field.controlKind !== "radio") return null;
  if (field.choiceSelectorType !== "id") return null;
  if (typeof next.value !== "string" || typeof next.selectorType !== "string") return null;

  return {
    fieldsToFill: [
      {
        selector: field.selector,
        value: field.value,
        controlKind: "radio",
        choiceSelectorType: "id",
      },
    ],
    nextButton: {
      value: next.value,
      selectorType: next.selectorType,
    },
  };
}
