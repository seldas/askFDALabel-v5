import xml.etree.ElementTree as ET
import logging
import re
from datetime import datetime
from dashboard.utils import extract_numeric_section_id, clean_spl_text

logger = logging.getLogger(__name__)

# --- CONSTANTS & MAPPINGS ---
LOINC_PLR_WARNINGS = '43685-7'  # Warnings and Precautions
LOINC_DESCRIPTION = '34089-3'   # Description
LOINC_ADVERSE_REACTIONS = '34084-4'

# Standard PLR Section Mapping (Code -> Canonical Number)
PLR_MAP = {
    '34067-9': '1', '34068-7': '2', '43678-2': '3', '34070-3': '4',
    '43685-7': '5', '34084-4': '6', '34073-7': '7', '43684-0': '8',
    '42227-9': '9', '34088-5': '10', '34089-3': '11', '34090-1': '12',
    '34091-9': '13', '34092-7': '14', '34093-5': '15', '34069-5': '16',
    '34076-0': '17'
}

PLR_TITLE_MAP = {
    '1': 'Indications and Usage', '2': 'Dosage and Administration',
    '3': 'Dosage Forms and Strengths', '4': 'Contraindications',
    '5': 'Warnings and Precautions', '6': 'Adverse Reactions',
    '7': 'Drug Interactions', '8': 'Use in Specific Populations',
    '9': 'Drug Abuse and Dependence', '10': 'Overdosage',
    '11': 'Description', '12': 'Clinical Pharmacology',
    '13': 'Nonclinical Toxicology', '14': 'Clinical Studies',
    '15': 'References', '16': 'How Supplied/Storage and Handling',
    '17': 'Patient Counseling Information'
}

# --- 1. CLASSIFICATION LOGIC ---

def identify_label_format(root):
    """Determines if the XML is PLR, non-PLR, or OTC."""
    def local(t): return t.split('}')[-1]
    
    all_codes = [c.get('code') for c in root.iter() if local(c.tag) == 'code']
    all_titles = [("".join(t.itertext())).upper() for t in root.iter() if local(t.tag) == 'title']

    # 1. PLR Check
    if LOINC_PLR_WARNINGS in all_codes:
        return "PLR"
    
    # 2. non-PLR Check
    if LOINC_DESCRIPTION in all_codes or any("DESCRIPTION" in t for t in all_titles):
        return "NON-PLR"
    
    # 3. Default to OTC
    return "OTC"

# --- 2. SHARED UTILITIES ---

def get_local_name(element):
    return element.tag.split('}')[-1] if '}' in element.tag else element.tag

def get_media_map(root):
    media_map = {}
    for m in root.iter():
        if get_local_name(m) == 'observationMedia':
            mid = m.get('ID')
            for val in m:
                if get_local_name(val) == 'value':
                    for ref in val:
                        if get_local_name(ref) == 'reference':
                            fname = ref.get('value')
                            if mid and fname: media_map[mid] = fname
    return media_map

def to_html(element, media_map=None, set_id=None):
    if element is None: return ""
    
    def _clean_chunk(text):
        if not text: return ""
        return re.sub(r'\s+', ' ', text)

    raw_tag = get_local_name(element)
    
    if raw_tag == 'renderMultiMedia':
        ref_id = element.get('referencedObject')
        filename = media_map.get(ref_id) if media_map else None
        
        child_html = ""
        for child in element:
            child_html += to_html(child, media_map, set_id)
            
        img_url = f"https://dailymed.nlm.nih.gov/dailymed/image.cfm?setid={set_id}&name={filename}" if filename and set_id else ""
        img_tag = f'<img src="{img_url}" style="max-width:100%"/>' if img_url else ""
        return f'<div class="spl-figure" style="text-align: center; margin: 20px 0;">{img_tag}{child_html}</div>{_clean_chunk(element.tail)}'

    tag_map = {
        'paragraph': 'p', 'linkHtml': 'a', 'list': 'ul', 'item': 'li',
        'content': 'span', 'sub': 'sub', 'sup': 'sup', 'br': 'br', 'caption': 'caption',
        'table': 'table', 'thead': 'thead', 'tbody': 'tbody', 'tfoot': 'tfoot',
        'tr': 'tr', 'th': 'th', 'td': 'td', 'col': 'col', 'colgroup': 'colgroup',
    }
    
    html_tag = tag_map.get(raw_tag, raw_tag) 
    if raw_tag == 'list' and element.get('listType') == 'ordered': 
        html_tag = 'ol'
    
    attrs = []
    for k, v in element.attrib.items():
        if html_tag == 'a' and k == 'href': 
            attrs.append(f'href="{v}"')
        if k == 'styleCode':
            styles = [s.lower() for s in v.split(' ')]
            classes = []
            if 'bold' in styles: classes.append('Bold')
            if 'italic' in styles: classes.append('Emphasis')
            if 'underline' in styles: classes.append('Underline')
            if classes: attrs.append(f'class="{" ".join(classes)}"')
        # Preserve colspan/rowspan for tables
        if k in ('colspan', 'rowspan', 'align', 'valign', 'width', 'scope'):
            attrs.append(f'{k}="{v}"')
    
    # Accessibility: header cells get scope="col" if not already set
    if html_tag == 'th' and not any(a.startswith('scope=') for a in attrs):
        attrs.append('scope="col"')

    inner_html = _clean_chunk(element.text)
    for child in element:
        child_raw_tag = get_local_name(child)
        if raw_tag == 'item' and child_raw_tag == 'caption':
            inner_html += _clean_chunk(child.tail)
            continue
        inner_html += to_html(child, media_map, set_id)
    
    if html_tag == 'br': 
        return f"<br/>{_clean_chunk(element.tail)}"

    # Wrap tables in a scrollable container
    if html_tag == 'table':
        table_html = f'<table class="spl-table">{inner_html}</table>'
        return f'<div class="spl-table-wrapper">{table_html}</div>{_clean_chunk(element.tail)}'
        
    return f"<{html_tag} {' '.join(attrs)}>{inner_html}</{html_tag}>{_clean_chunk(element.tail)}"

def parse_product_section(sec_el):
    """Parses the SPL product data elements section (code 48780-1).
    Extracts NDC, name, form, ingredients, packaging, and the FDA Application
    Number / marketing category found in sibling <subjectOf><approval> nodes.
    """
    def local(t): return t.split('}')[-1]

    def find_child(elem, tag):
        return next((c for c in elem if local(c.tag) == tag), None)

    def find_children(elem, tag):
        return [c for c in elem if local(c.tag) == tag]

    products = []
    for subject in find_children(sec_el, 'subject'):
        for manuf_prod_wrapper in find_children(subject, 'manufacturedProduct'):
            # --- Extract Application Number and Marketing Category ---
            # These live in sibling <subjectOf><approval> of the wrapper, not the inner product.
            app_num = ''
            app_type = ''
            for subject_of in find_children(manuf_prod_wrapper, 'subjectOf'):
                approval = find_child(subject_of, 'approval')
                if approval is None:
                    continue
                id_el = find_child(approval, 'id')
                if id_el is not None and id_el.get('root') in (
                    '2.16.840.1.113883.3.150',        # NDA / ANDA / BLA
                    '2.16.840.1.113883.3.989.2.1.1.1' # OTC monograph
                ):
                    app_num = id_el.get('extension', '')
                code_el = find_child(approval, 'code')
                if code_el is not None:
                    app_type = code_el.get('displayName', '')
                if app_num:
                    break  # first approval block is sufficient

            # --- Parse each inner manufacturedProduct ---
            for manuf_prod in find_children(manuf_prod_wrapper, 'manufacturedProduct'):
                product = {
                    'ndc': '', 'name': '', 'form': '',
                    'app_num': app_num, 'app_type': app_type,
                    'ingredients': [], 'packaging': []
                }
                code_nodes = find_children(manuf_prod, 'code')
                if code_nodes: product['ndc'] = code_nodes[0].get('code', '')
                name_nodes = find_children(manuf_prod, 'name')
                if name_nodes: product['name'] = "".join(name_nodes[0].itertext()).strip()
                form_nodes = find_children(manuf_prod, 'formCode')
                if form_nodes: product['form'] = form_nodes[0].get('displayName', '')
                for ingr in find_children(manuf_prod, 'ingredient'):
                    ingr_data = {'type': ingr.get('classCode', ''), 'name': '', 'strength': ''}
                    subst_nodes = [c for c in ingr if local(c.tag) in ['ingredientSubstance', 'activeMedicine']]
                    if subst_nodes:
                        name_nodes2 = find_children(subst_nodes[0], 'name')
                        if name_nodes2: ingr_data['name'] = "".join(name_nodes2[0].itertext()).strip()
                    qty_nodes = find_children(ingr, 'quantity')
                    if qty_nodes:
                        num = qty_nodes[0].find('{*}numerator')
                        den = qty_nodes[0].find('{*}denominator')
                        if num is not None:
                            val, unit = num.get('value', ''), num.get('unit', '')
                            ingr_data['strength'] = f"{val} {unit}".strip()
                            if den is not None and den.get('value') and den.get('value') != '1':
                                ingr_data['strength'] += f" / {den.get('value')} {den.get('unit', '')}".strip()
                    product['ingredients'].append(ingr_data)
                for content in find_children(manuf_prod, 'asContent'):
                    pkg = {'quantity': '', 'form': ''}
                    qty_nodes = find_children(content, 'quantity')
                    if qty_nodes:
                        num = qty_nodes[0].find('{*}numerator')
                        if num is not None:
                            pkg['quantity'] = num.get('value', '')
                            trans = num.find('{*}translation')
                            if trans is not None: pkg['form'] = trans.get('displayName', '')
                    product['packaging'].append(pkg)
                products.append(product)
    return products


# --- 3. FORMAT-SPECIFIC HANDLERS ---

def _process_plr_label(sections, highlights):
    """PLR specific: Enforces 1-17 numbering and extracts highlights."""
    processed_toc = []
    
    for s in sections:
        # Enforce Canonical Numbering based on Code
        if s.get('code') in PLR_MAP:
            s['numeric_id'] = PLR_MAP[s['code']]
            canonical_title = PLR_TITLE_MAP.get(s['numeric_id'], "")
            
            # Reconstruct title if missing or messy
            if not s['title'] or 'UNCLASSIFIED' in s['title'].upper():
                s['title'] = f"{s['numeric_id']} {canonical_title}"
            elif s['numeric_id'] not in s['title']:
                # Ensure title has the number
                s['title'] = f"{s['numeric_id']} {s['title']}"
        
        # Build TOC Item
        toc_title = "Boxed Warnings" if s.get('is_boxed_warning') else s['title']
        item = {
            'title': toc_title,
            'id': s['id'],
            'numeric_id': s.get('numeric_id'),
            'is_boxed_warning': s.get('is_boxed_warning', False),
            'children': _build_recursive_toc(s.get('children', []), prefix=f"{s.get('numeric_id', '')}.")
        }
        processed_toc.append(item)
        
    return sections, processed_toc

def _process_non_plr_label(sections):
    """non-PLR specific: Sequential numbering without strict 1-17 rules."""
    processed_toc = []
    count = 1
    
    EXCLUDE_FROM_NUMBERING = ["RX ONLY", "PACKAGE LABEL", "PRINCIPAL DISPLAY PANEL", "RECENT MAJOR CHANGES", "DOCUMENT HISTORY", "REVISION HISTORY"]

    for s in sections:
        title = s.get('title', "").strip()
        is_excluded = any(ex in title.upper() for ex in EXCLUDE_FROM_NUMBERING)
        is_boxed = s.get('is_boxed_warning', False)
        
        num_id = s.get('numeric_id')
        
        if not num_id and not is_boxed and not is_excluded:
            # Auto-number ONLY if it's not excluded
            num_id = str(count)
            # Update the section title in place for the view?
            # User asked to HIDE non-official numbers.
            # So maybe we just don't add it to the title text, but keep it for ID.
            if not re.match(r'^\d', title):
                s['title'] = f"{count}. {title}"
                s['numeric_id'] = num_id
            count += 1
        
        toc_title = "Boxed Warnings" if is_boxed else s['title']
        processed_toc.append({
            'title': toc_title,
            'id': s['id'],
            'numeric_id': num_id,
            'is_boxed_warning': is_boxed,
            'children': _build_recursive_toc(s.get('children', []), prefix=f"{num_id}." if num_id else "")
        })
        
    return sections, processed_toc

def _process_otc_label(sections):
    """OTC specific: Groups sections into a 'Drug Facts' virtual container."""
    drug_facts = {
        'title': 'Drug Facts',
        'id': 'drug-facts-grouping',
        'children': [],
        'is_drug_facts': True
    }
    other_sections = []
    
    # Typical OTC LOINC codes
    OTC_FACTS_CODES = {'55106-9', '55105-1', '50570-1', '50567-7', '50566-9', '34067-9', '34071-1', '34068-7'}

    for s in sections:
        if s.get('code') in OTC_FACTS_CODES or "FACTS" in (s.get('title') or "").upper():
            s['is_drug_facts_item'] = True
            drug_facts['children'].append(s)
        else:
            other_sections.append(s)
            
    final_sections = [drug_facts] + other_sections if drug_facts['children'] else sections
    
    processed_toc = _build_recursive_toc(final_sections)
    return final_sections, processed_toc

def _build_recursive_toc(sections, prefix=""):
    toc = []
    for s in sections:
        item = {
            'title': s.get('title', 'Untitled'),
            'id': s.get('id'),
            'numeric_id': s.get('numeric_id'),
            'is_boxed_warning': s.get('is_boxed_warning', False),
            'is_drug_facts': s.get('is_drug_facts', False),
            'is_drug_facts_item': s.get('is_drug_facts_item', False)
        }
        if s.get('children'):
            item['children'] = _build_recursive_toc(s['children'], prefix)
        toc.append(item)
    return toc

# --- 4. THE MAIN DISPATCHER ---

def detect_multiple_xml_roots(xml_text: str) -> bool:
    if not xml_text:
        return False
    matches = re.findall(r'<\?xml\b|<document\b', xml_text, flags=re.IGNORECASE)
    return len(matches) > 1

def parse_spl_xml(xml_string, set_id=None):
    if not xml_string: 
        return "Error", [], None, None, [], []

    try:
        # Cleanup
        xml_cleaned = ''.join(c for c in xml_string if c.isprintable() or c in '\n\r\t')
        if detect_multiple_xml_roots(xml_cleaned):
            logger.warning("Possible multiple XML roots detected for set_id=%s", set_id)

        root = ET.fromstring(xml_cleaned.strip())
        
        # Identify Format
        label_format = identify_label_format(root)
        logger.info(f"Processing label as {label_format} format. SetID: {set_id}")

        # Shared Extractions
        media_map = get_media_map(root)
        
        doc_title = "Unknown Drug"
        title_node = root.find(".//{urn:hl7-org:v3}title")
        if title_node is None: title_node = root.find(".//title") # fallback
        if title_node is not None:
            doc_title = "".join(title_node.itertext()).strip()
            # Clean doc_title if it contains SPL boilerplate
            if "HIGHLIGHTS" in doc_title.upper():
                m = re.search(r'\(([^)]+)\)', doc_title)
                if m:
                    doc_title = m.group(1).strip()
                else:
                    doc_title = re.sub(r'(?i)^HIGHLIGHTS OF PRESCRIBING INFORMATION\s*', '', doc_title).strip()
            # Remove common "Label for..." prefix
            doc_title = re.sub(r'(?i)^Label for\s+', '', doc_title).strip()
            doc_title = " ".join(doc_title.split()) # normalize whitespace

        # 1. Raw Section Extraction (Recursive)
        def local(t): return t.split('}')[-1]
        raw_sections = []
        highlights = []
        product_data = []
        
        def parse_sec_recursive(sec_el):
            t_nodes = [n for n in sec_el if local(n.tag) == 'title']
            txt_nodes = [n for n in sec_el if local(n.tag) == 'text']
            
            # Title Extraction
            title = ""
            if t_nodes:
                title = " ".join("".join(t_nodes[0].itertext()).split()).strip()
            
            code_node = None
            for child in sec_el:
                if local(child.tag) == 'code':
                    code_node = child
                    break
            
            code_val = code_node.get('code', '') if code_node is not None else ""
            code_display = code_node.get('displayName', '') if code_node is not None else ""

            # Fallback Title
            if not title and txt_nodes:
                # First bold text strategy
                first_p = [n for n in txt_nodes[0] if local(n.tag) == 'paragraph']
                if first_p:
                    first_content = [n for n in first_p[0] if local(n.tag) == 'content' and 'bold' in (n.get('styleCode') or '').lower()]
                    if first_content:
                        candidate = " ".join("".join(first_content[0].itertext()).split()).strip()
                        if candidate and len(candidate) < 150:
                            title = candidate.rstrip(':').strip()
            
            if not title and code_display:
                title = code_display.replace('OTC - ', '').replace(' SECTION', '').replace('.PRINCIPAL DISPLAY PANEL', '').strip()
                if title.isupper(): title = title.capitalize()

            # Filter Product Data (Fix 1: Enhanced Listing Detection)
            has_subject = any(local(c.tag) == 'subject' for c in sec_el)
            is_listing = (code_val == '48780-1') or ('LISTING DATA' in title.upper()) or ('PRODUCT DATA' in title.upper()) or (not title and has_subject)
            
            if is_listing:
                product_data.extend(parse_product_section(sec_el))
                return None

            # ID Generation
            sec_id = sec_el.get('ID')
            if not sec_id:
                id_nodes = [n for n in sec_el if local(n.tag) == 'id']
                if id_nodes: sec_id = id_nodes[0].get('root')
            if not sec_id:
                import hashlib
                content_sample = f"{set_id}_{code_val}_{title}"
                sec_id = "sec_" + hashlib.md5(content_sample.encode()).hexdigest()[:10]

            # Content
            content = to_html(txt_nodes[0], media_map, set_id) if txt_nodes else ""
            content = clean_spl_text(content)
            
            # Highlights
            if any(local(child.tag) == 'excerpt' for child in sec_el):
                for exc in [c for c in sec_el if local(c.tag) == 'excerpt']:
                    for hl in [c for c in exc if local(c.tag) == 'highlight']:
                        hl_html = to_html(hl, media_map, set_id)
                        highlights.append({'source_section_title': title or "Highlights", 'content_html': clean_spl_text(hl_html)})

            # Children
            children = []
            for comp in [c for c in sec_el if local(c.tag) == 'component']:
                for sub in [c for c in comp if local(c.tag) == 'section']:
                    parsed_sub = parse_sec_recursive(sub)
                    if parsed_sub: children.append(parsed_sub)
            
            is_boxed = (code_val == '34066-1') or (title.upper().startswith('WARNING:')) or ('BOXED WARNING' in title.upper())

            return {
                'id': sec_id, 
                'numeric_id': extract_numeric_section_id(title), 
                'title': title, 
                'content': content, 
                'children': children, 
                'is_boxed_warning': is_boxed,
                'code': code_val
            }

        # Main Loop
        for sb in [n for n in root.iter() if local(n.tag) == 'structuredBody']:
            for comp in [c for c in sb if local(c.tag) == 'component']:
                for sec in [c for c in comp if local(c.tag) == 'section']:
                    parsed = parse_sec_recursive(sec)
                    if parsed: raw_sections.append(parsed)
        
        # 2. Route to specialized handlers
        if label_format == "PLR":
            sections, toc = _process_plr_label(raw_sections, highlights)
        elif label_format == "NON-PLR":
            sections, toc = _process_non_plr_label(raw_sections)
        else: # OTC
            sections, toc = _process_otc_label(raw_sections)

        # 3. Final Assembly
        if highlights:
            toc.insert(0, {'title': 'Highlights', 'id': 'highlights-section', 'is_highlights': True})

        return doc_title, sections, label_format, highlights, toc, product_data

    except Exception as e:
        logger.error(f"Refactored XML parse error: {e}", exc_info=True)
        return "Error", [], None, None, [], []

def extract_metadata_from_xml(xml_string):
    if not xml_string: return None
    try:
        xml_string_cleaned = ''.join(c for c in xml_string if c.isprintable() or c in '\n\r\t')
        root = ET.fromstring(xml_string_cleaned.strip())
        
        def local(t): return t.split('}')[-1]
        def find_nodes_by_local_name(parent, local_name):
            return [n for n in parent.iter() if local(n.tag) == local_name]

        # 1. Set ID
        set_id = "N/A"
        set_id_nodes = find_nodes_by_local_name(root, 'setId')
        if set_id_nodes: set_id = set_id_nodes[0].get('root', 'N/A')
        
        # 2. Effective Time
        effective_time = "N/A"
        eff_nodes = find_nodes_by_local_name(root, 'effectiveTime')
        if eff_nodes:
            val = eff_nodes[0].get('value', '')
            try:
                effective_time = datetime.strptime(val[:8], '%Y%m%d').strftime('%B %d, %Y')
            except: pass

        # 3. Organizations & Manufacturers (Deep Extraction)
        companies = []
        seen_keys = set()
        manufacturer = "Unknown Manufacturer"

        def extract_orgs_recursive(element, default_role="Distributed by"):
            def local(t): return t.split('}')[-1]
            
            # Find all organizations in this branch
            org_nodes = [n for n in element if local(n.tag) in ['representedOrganization', 'assignedOrganization']]
            
            for org in org_nodes:
                name_node = org.find('{*}name')
                if name_node is None: name_node = org.find('name')
                
                if name_node is not None:
                    name = "".join(name_node.itertext()).strip()
                    if name:
                        # Find DUNS
                        id_nodes = [n for n in org if local(n.tag) == 'id']
                        duns = None
                        for idn in id_nodes:
                            if idn.get('root') == '1.3.6.1.4.1.519.1':
                                duns = idn.get('extension')
                                break
                        
                        # Find Operations/Performance to decide role
                        operations = [perf.get('displayName', '').lower() for perf in org.findall('.//{*}performance/{*}actDefinition/{*}code')]
                        
                        role = default_role
                        if any(op in ["manufacture", "analysis", "api manufacture"] for op in operations):
                            role = "Manufactured by"
                        elif any(op in ["repack", "relabel", "label", "pack"] for op in operations):
                            role = "Distributed by"
                        
                        key = f"{name}_{role}_{duns}"
                        if key not in seen_keys:
                            companies.append({
                                "name": name,
                                "duns": duns,
                                "role": role,
                                "source": "header"
                            })
                            seen_keys.add(key)
                
                # Recursive call for nested entities
                for sub_entity in org.findall('.//{*}assignedEntity'):
                    extract_orgs_recursive(sub_entity, "Manufactured by")
                for sub_entity in org.findall('.//{*}assignedOrganization'):
                    extract_orgs_recursive(sub_entity, "Distributed by")

        # Initial trigger for author/registrant
        author_node = root.find('.//{*}author')
        if author_node is not None:
            extract_orgs_recursive(author_node, "Distributed by")
        
        # Fallback to simple scan if recursive missed something
        possible_orgs = find_nodes_by_local_name(root, 'representedOrganization') + \
                        find_nodes_by_local_name(root, 'assignedOrganization')
        
        for org in possible_orgs:
            name_nodes = find_nodes_by_local_name(org, 'name')
            if name_nodes:
                name = "".join(name_nodes[0].itertext()).strip()
                if name:
                    if not any(c['name'] == name for c in companies):
                        id_nodes = find_nodes_by_local_name(org, 'id')
                        duns = None
                        for idn in id_nodes:
                            if idn.get('root') == '1.3.6.1.4.1.519.1':
                                duns = idn.get('extension')
                                break
                        
                        companies.append({
                            "name": name,
                            "duns": duns,
                            "role": "Distributed by",
                            "source": "header"
                        })

        if companies:
            manufacturer = companies[0]['name']

        # Heuristic search in text for "Manufactured", "Distributed", etc.
        all_paragraphs = []
        for p in root.iter():
            if local(p.tag) == 'paragraph':
                all_paragraphs.append(p)
        
        role_patterns = [
            r"Manufactured\s+for:?", r"Distributed\s+by:?", r"Repackaged\s+by:?",
            r"Manufactured\s+by:?", r"Marketed\s+by:?", r"^by:?$"
        ]

        safety_contacts = []
        safety_pattern = r"To\s+report\s+SUSPECTED\s+ADVERSE\s+REACTIONS,?\s+contact\s+([^at]+)\s+at\s+([0-9\-\(\)\s]{7,25})"

        for i, p in enumerate(all_paragraphs):
            text = "".join(p.itertext()).strip()
            
            # Safety Contact Check
            sm = re.search(safety_pattern, text, re.IGNORECASE)
            if sm:
                sc_name = sm.group(1).strip()
                sc_phone = sm.group(2).strip()
                if sc_name and sc_phone:
                    safety_contacts.append({"name": sc_name, "phone": sc_phone})

            if any(re.search(pat, text, re.IGNORECASE) for pat in role_patterns):
                current_role = text
                # Try to find name in next paragraph(s)
                potential_name = ""
                name_idx = i + 1
                
                if name_idx < len(all_paragraphs):
                    potential_name = "".join(all_paragraphs[name_idx].itertext()).strip()
                
                # If current text has content after colon, use that
                if ":" in text and len(text.split(":", 1)[1].strip()) > 3:
                    potential_name = text.split(":", 1)[1].strip()
                    name_idx = i # address starts after this

                if potential_name and len(potential_name) < 100 and not potential_name.endswith('.'):
                    comp_name = potential_name
                    # Collect subsequent lines as address until we hit a blank or another role
                    address_lines = []
                    for j in range(name_idx + 1, min(name_idx + 4, len(all_paragraphs))):
                        addr_p = all_paragraphs[j]
                        addr_text = "".join(addr_p.itertext()).strip()
                        if not addr_text or any(re.search(pat, addr_text, re.IGNORECASE) for pat in role_patterns):
                            break
                        # Address heuristic: not too long, not a sentence
                        if len(addr_text) < 150 and not addr_text.endswith('.'):
                            address_lines.append(addr_text)
                    
                    if not any(c['name'].lower() == comp_name.lower() for c in companies):
                        role = current_role.lower()
                        if "manufactured by" in role or "manufacture by" in role:
                            final_role = "Manufactured by"
                        elif "manufactured for" in role or "distributed" in role or "repackaged" in role or "marketed" in role:
                            final_role = "Distributed by"
                        elif "by:" in role:
                            # Contextual fallback
                            final_role = "Manufactured by"
                        else:
                            final_role = "Distributed by"

                        companies.append({
                            "name": comp_name,
                            "role": final_role,
                            "address": ", ".join(address_lines),
                            "source": "text"
                        })


        # Merge Safety Contacts
        for sc in safety_contacts:
            found = False
            for c in companies:
                if sc['name'].lower() in c['name'].lower() or c['name'].lower() in sc['name'].lower():
                    c['safety_phone'] = sc['phone']
                    found = True
                    break
            if not found:
                companies.append({
                    "name": sc['name'],
                    "role": "Distributed by",
                    "safety_phone": sc['phone'],
                    "source": "text"
                })

        # 4. Brand & Generic Name (Refined)
        brand_name = "Unknown Drug"
        generic_name = "Unknown Generic"
        
        # Search both manufacturedMaterial and manufacturedProduct
        potential_nodes = find_nodes_by_local_name(root, 'manufacturedMaterial') + \
                          find_nodes_by_local_name(root, 'manufacturedProduct')
        
        brand_candidates = []
        generic_candidates = []
        
        def clean_drug_name(name):
            if not name: return ""
            # Collapse whitespace
            name = " ".join(name.split())
            # Strip common suffixes (dosage forms and strengths)
            name = re.sub(r'(?i)\s+(tablets?|capsules?|injection|solution|suspension|spray|inhaler|powder|cream|ointment|gel|patch|film|liquid|drops?|aerosol|syrup|elixir)\b.*$', '', name).strip()
            name = re.sub(r'\d+(\.\d+)?\s*(mg|mcg|g|ml|%|unit|iu|mEq|mmol|USP|BP)\b.*$', '', name, flags=re.IGNORECASE).strip()
            # Remove trailing punctuation
            name = name.rstrip(':,;. ')
            return name

        for node in potential_nodes:
            n_nodes = [n for n in node if local(n.tag) == 'name']
            if n_nodes:
                raw_brand = "".join(n_nodes[0].itertext()).strip()
                if raw_brand: 
                    brand_candidates.append(clean_drug_name(raw_brand))
            
            # Look for genericMedicine either directly or under asEntityWithGeneric
            gen_nodes = find_nodes_by_local_name(node, 'genericMedicine')
            for gn in gen_nodes:
                gn_name_nodes = [n for n in gn if local(n.tag) == 'name']
                if gn_name_nodes:
                    raw_gen = "".join(gn_name_nodes[0].itertext()).strip()
                    if raw_gen: generic_candidates.append(clean_drug_name(raw_gen))

        if brand_candidates:
            # Pick shortest cleaned brand name as the most likely "core" brand
            brand_name = min([b for b in brand_candidates if b], key=len)
        
        if generic_candidates:
            generic_name = min([g for g in generic_candidates if g], key=len)

        if brand_name == "Unknown Drug":
            title_node = root.find(".//{urn:hl7-org:v3}title")
            if title_node is None: title_node = root.find(".//title") # fallback
            if title_node is not None: 
                raw_title = "".join(title_node.itertext()).strip()
                # Clean root title if it contains SPL boilerplate
                if "HIGHLIGHTS" in raw_title.upper():
                    m = re.search(r'\(([^)]+)\)', raw_title)
                    if m:
                        brand_name = clean_drug_name(m.group(1))
                    else:
                        brand_name = re.sub(r'(?i)^HIGHLIGHTS OF PRESCRIBING INFORMATION\s*', '', raw_title).strip()
                        brand_name = clean_drug_name(brand_name)
                else:
                    brand_name = clean_drug_name(raw_title)

        # 5. NDC and Application Number Deep Search
        ndcs = set()
        apps = set()
        epcs = set()
        moas = set()
        
        for elem in root.iter():
            # NDC
            if elem.get('codeSystem') == '2.16.840.1.113883.6.69':
                v = elem.get('code')
                if v: ndcs.add(v)
            
            # Application Number
            if elem.get('root') == '2.16.840.1.113883.3.150' or elem.get('root') == '2.16.840.1.113883.3.989.2.1.1.1':
                v = elem.get('extension')
                if v: apps.add(v)
            
            # EPC & MOA (Pharmaceutical Class)
            if local(elem.tag) == 'pharmaceuticalClass':
                display_name = elem.get('displayName', '')
                if not display_name:
                    name_node = elem.find('{*}name')
                    if name_node is not None: display_name = "".join(name_node.itertext()).strip()
                
                if display_name:
                    if '[EPC]' in display_name.upper():
                        epcs.add(display_name)
                    elif '[MOA]' in display_name.upper():
                        moas.add(display_name)
                    else:
                        # Fallback: if codeSystem is for EPC/MOA
                        cs = elem.get('codeSystem')
                        if cs == '2.16.840.1.113883.3.26.1.1': # NCI Thesaurus usually
                            epcs.add(display_name)

        return {
            'set_id': set_id,
            'brand_name': brand_name,
            'generic_name': generic_name,
            'manufacturer_name': manufacturer,
            'companies': companies,
            'effective_time': effective_time,
            'label_format': identify_label_format(root),
            'ndc': ", ".join(sorted(list(ndcs))) if ndcs else "N/A",
            'application_number': ", ".join(sorted(list(apps))) if apps else "N/A",
            'epc': ", ".join(sorted(list(epcs))) if epcs else "N/A",
            'moa': ", ".join(sorted(list(moas))) if moas else "N/A",
            'document_type': "Label", # Simplified
            'has_boxed_warning': any(s.upper().startswith('WARNING') for s in [("".join(t.itertext())).strip() for t in root.iter() if local(t.tag) == 'title'])
        }
    except Exception as e:
        logger.error(f"Metadata extraction error: {e}")
        return None

def get_aggregate_content(section):
    """
    Recursively collects content from a section and its children.
    Children that have their own numeric section IDs are skipped, as they 
    will be compared independently.
    """
    content = section.get('content', '')
    for child in section.get('children', []):
        # Check if the child has its own numeric ID
        if not extract_numeric_section_id(child.get('title', '')):
            if child.get('title'):
                # Add child title as a sub-header if it exists
                content += f"<h4>{child['title']}</h4>"
            content += get_aggregate_content(child)
    return content

def flatten_sections(sections):
    res = []
    for s in sections:
        res.append(s)
        if s.get('children'): res.extend(flatten_sections(s['children']))
    return res

def extract_sections_by_loinc(xml_content):
    """
    Parses SPL XML and returns a dictionary of sections keyed by LOINC code.
    { '34071-1': {'title': '...', 'content': '...'}, ... }
    """
    sections = {}
    if not xml_content: return sections
    
    try:
        # Clean XML string
        clean_xml = xml_content.encode('ascii', 'ignore').decode('ascii')
        root = ET.fromstring(clean_xml)
        
        ns = {'v3': 'urn:hl7-org:v3'}
        
        # Handle both namespaced and non-namespaced tags
        def local(tag): return tag.split('}')[-1] if '}' in tag else tag

        # Find all section elements
        # We search both with and without namespace
        found_sections = root.findall(".//v3:section", ns)
        if not found_sections:
            found_sections = [s for s in root.iter() if local(s.tag) == 'section']

        for section in found_sections:
            code_el = section.find("v3:code", ns)
            if code_el is None:
                code_el = next((c for c in section if local(c.tag) == 'code'), None)
            
            if code_el is not None:
                loinc = code_el.get('code')
                if loinc:
                    title_el = section.find("v3:title", ns)
                    if title_el is None:
                        title_el = next((t for t in section if local(t.tag) == 'title'), None)
                    
                    title = "".join(title_el.itertext()).strip() if title_el is not None else loinc
                    
                    # RECURSIVE TEXT EXTRACTION: Get ALL text within the section
                    # This ensures content inside nested lists, tables, or generic tags is captured.
                    def get_text_recursive(element):
                        return "".join(element.itertext()).strip()

                    content = get_text_recursive(section)
                    
                    # Only keep the FIRST occurrence or the longest one
                    if loinc not in sections or len(content) > len(sections[loinc]['content']):
                        sections[loinc] = {
                            'title': title,
                            'content': content
                        }
    except Exception as e:
        logger.error(f"Error in extract_sections_by_loinc: {e}")
        
    return sections
