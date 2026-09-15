// User-facing wording only. These labels never rename stored feature/target IDs.
export const WORD_INTERPRETATION_COPY = Object.freeze({
  action: "Interpretation",
  title: "Word interpretation",
  choicesTitle: "Suggested wording",
  intro: "Review the translation and lexicon wording, or record an alternative interpretation for this word in this verse.",
  boundary: "Saved wording is a study aid. It does not change the Bible text or the source definition.",
  customTitle: "Alternative wording",
  customAction: "Add alternative wording",
  empty: "No source-based suggestions are available for this word.",
  required: "Enter alternative wording before saving.",
});

export function meaningChoiceSourceLabel(source) {
  return ({ saved: "Saved wording", exact_bsb: "BSB wording", english: "Source translation", gloss: "Source gloss", lexicon: "Lexicon definition" })[source] || "Source wording";
}
