import xml.etree.ElementTree as ET
import re
from datetime import datetime

def extract_metadata_from_xml(xml_string):
    if not xml_string: return None
    try:
        # Simple cleanup
        xml_string_cleaned = "".join(c for c in xml_string if c.isprintable() or c in "\n\r\t")
        root = ET.fromstring(xml_string_cleaned.strip())
        
        def local(t): return t.split("}")[-1]
        def find_nodes_by_local_name(parent, local_name):
            return [n for n in parent.iter() if local(n.tag) == local_name]

        # 1. Set ID
        set_id = "N/A"
        set_id_nodes = find_nodes_by_local_name(root, "setId")
        if set_id_nodes: set_id = set_id_nodes[0].get("root", "N/A")
        
        # 3. Manufacturer (Broad search)
        companies = []
        seen_names = set()

        possible_orgs = find_nodes_by_local_name(root, "representedOrganization") + \
                        find_nodes_by_local_name(root, "assignedOrganization") + \
                        find_nodes_by_local_name(root, "author") 
        
        for org in possible_orgs:
            name_nodes = find_nodes_by_local_name(org, "name")
            if name_nodes:
                name = "".join(name_nodes[0].itertext()).strip()
                if name and name not in seen_names:
                    id_node = org.find("{*}id")
                    if id_node is None:
                        # try searching by local name
                        id_node = find_nodes_by_local_name(org, "id")
                        id_node = id_node[0] if id_node else None

                    duns = id_node.get("extension") if id_node is not None and id_node.get("root") == "1.3.6.1.4.1.519.1" else None
                    companies.append({
                        "name": name,
                        "duns": duns,
                        "source": "header",
                        "role": "Registrant/Labeler"
                    })
                    seen_names.add(name)

        # Search in text for "Manufactured" or "Distributed"
        all_paragraphs = []
        for p in root.iter():
            if local(p.tag) == "paragraph":
                all_paragraphs.append(p)
        
        for i, p in enumerate(all_paragraphs):
            text = "".join(p.itertext()).strip()
            # Patterns for roles
            patterns = [
                r"Manufactured\s+for:?",
                r"Distributed\s+by:?",
                r"Repackaged\s+by:?",
                r"Manufactured\s+by:?",
                r"Marketed\s+by:?",
                r"^by:?$" # standalone "by:"
            ]
            if any(re.search(pat, text, re.IGNORECASE) for pat in patterns):
                # The next paragraph is likely the company name
                if i + 1 < len(all_paragraphs):
                    next_p = all_paragraphs[i+1]
                    comp_name = "".join(next_p.itertext()).strip()
                    if comp_name and len(comp_name) < 100 and comp_name not in seen_names:
                        # Maybe the one after is the address?
                        address = ""
                        if i + 2 < len(all_paragraphs):
                            addr_p = all_paragraphs[i+2]
                            addr_text = "".join(addr_p.itertext()).strip()
                            # Addresses often contain numbers or zip codes or specific city/state patterns
                            if addr_text and len(addr_text) < 150 and (re.search(r"\d", addr_text) or "," in addr_text):
                                address = addr_text
                        
                        role = text
                        if role.lower() == "by:" and i > 0:
                            # Contextual role from previous lines
                            role = "Manufactured/Distributed by"

                        companies.append({
                            "name": comp_name,
                            "role": role,
                            "address": address,
                            "source": "text"
                        })
                        seen_names.add(comp_name)

        return {
            "set_id": set_id,
            "companies": companies
        }
    except Exception as e:
        import traceback
        traceback.print_exc()
        print(f"Error: {e}")
        return None

with open(r"data\uploads\spl-doc-PLR.xml", "r", encoding="utf-8") as f:
    xml_content = f.read()

metadata = extract_metadata_from_xml(xml_content)
import json
print(json.dumps(metadata, indent=2))
