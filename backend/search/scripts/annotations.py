"""
Canonical definition of the annotation tags the chat assistant may emit.

The frontend turns every ``<annotation class="drug">`` into a clickable chip; a
click adds the tag's text to the ``drugNames`` filter, which
``keyword_retriever`` feeds straight into

    product_names ILIKE %term% OR generic_names ILIKE %term%
       OR active_ingredients ILIKE %term%

on ``labeling.sum_spl``. So the tag body is not decoration -- it is a search
term, and anything the model wraps that is not a drug name as those columns
spell it produces a chip that finds nothing.

Drug is the only class left. The others (adverse_events, ndc, temporal) were
retired along with full-text search: with ``labeling.spl_sections`` dropped
there is nothing to match an adverse-event or section term against, so a chip
for one could only ever come back empty.

Every prompt that annotates assistant output imports :data:`ANNOTATION_RULES`
rather than restating the rules, so the model is told the same thing everywhere.
"""

#: Appended to every system prompt whose output the frontend annotates.
ANNOTATION_RULES = """
In your response, wrap every drug name in a custom XML tag so the interface can
turn it into a clickable search chip:

    <annotation class="drug">Drug Name</annotation>

The tag body is used verbatim as a database search term against the product
name, generic name and active ingredient columns, so it must be standardized:

- Tag the drug name only. No strength, dosage form, route, package size or
  manufacturer inside the tag ("<annotation class="drug">metformin</annotation>
  500 mg tablets", never "<annotation class="drug">metformin 500 mg
  tablets</annotation>").
- Use the established generic (nonproprietary) name, or the brand name exactly
  as it is marketed. Do not invent hyphenation, expand abbreviations or
  translate between the two.
- One drug per tag. Tag each name separately in a list rather than wrapping the
  whole list.
- Keep the salt or ester only when it is part of the name as marketed
  ("metoprolol succinate"). Drop trailing punctuation, possessives and
  parenthetical asides.
- Do not tag drug classes, indications, symptoms, adverse reactions, NDC codes,
  dates or durations. Only names of specific drug products or substances.

Example: "The <annotation class="drug">aspirin</annotation> and
<annotation class="drug">clopidogrel</annotation> labels both list
gastrointestinal bleeding as a risk."

Do not explain these tags to the user.
""".strip()
