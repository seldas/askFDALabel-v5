Date: 02/19/2026

1. fix the highlights and comments bug in dashboard label view page; it will require a new migrate to make the project_id in labelAnnotation table nullable;
2. 

Date: 02/20/2026
1. in xml_handling, do not show "<code code="48780-1" codeSystem="2.16.840.1.113883.6.1" displayName="SPL listing data elements section"/>" as a separated page/section, if it appears; this section is used about what product/info was included in the spl, so we need a different strategy to process it instead of treating it as a regular labeling section. 
2. re-design the layout of the label view page, the first layer should be the functions (label/faer/agents); the layout will be drug meta-data, function panels, and placeholder for the detailed function. The second layer will be inside the label panel, including menu and main content. The third layer will be the main content in label panel, which will look like a "book", we do not require each section only have one page, if it is a long section should be presented in multiple pages.
3. re-design of the agent panel; particularly for tox agent, it should displayed in a way that we are consolidating multiple sources together, we will elaborate this idea later.

1 -  spl listing data elements section

1. Modify `backend/dashboard/services/xml_handler.py`:
       * Update parse_spl_xml to detect and filter out sections with code 48780-1 ("SPL listing data elements section").
       * Instead of including these in the main sections list (which are rendered as regular labeling text), capture them into a
         separate product_data list.
       * Implement a new helper function parse_product_data(sec_el) or similar to extract structured information (like ingredients,
         strengths, and dosage forms) from the manufacturedProduct elements within this section.
       * Update parse_spl_xml to return this structured product_data.


   2. Update Return Signatures and Callers:
       * Change parse_spl_xml to return a 6-tuple: (doc_title, sections, fallback_html, highlights, table_of_contents, product_data).
       * Update backend/dashboard/routes/main.py to handle the new return value and include product_data in the JSON response sent to
         the frontend.
       * Update backend/labelcomp/blueprint.py to accommodate the change in return signature.


   3. Frontend Preparation (Implicitly part of the "different strategy"):
       * By excluding it from sections, it will automatically disappear from the "book" view and TOC.
       * The new product_data field in the API response can then be used in the re-designed layout (Task 2) to show a "Product Info"
         or "Ingredients" tab/panel.


   4. Verification:
       * Test with an XML file known to contain this section (e.g., 61e9324f-3ef3-45d7-9735-a89a03aeec42.xml).
       * Confirm it is no longer listed in the TOC.
       * Confirm the API returns the structured product data.