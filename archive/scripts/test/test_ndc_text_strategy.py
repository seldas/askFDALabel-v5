import xml.etree.ElementTree as ET
import glob
import re

def test_extract(file_path):
    print(f"--- Testing {file_path} ---")
    try:
        tree = ET.parse(file_path)
        root = tree.getroot()
        
        # 1. OID Strategy (Baseline)
        oid_ndcs = set()
        for elem in root.iter():
            if elem.get('codeSystem') == '2.16.840.1.113883.6.69':
                code = elem.get('code')
                if code:
                    oid_ndcs.add(code)
        print(f"OID NDCs: {sorted(list(oid_ndcs))}")

        # 2. Text Strategy
        # Get all text content
        full_text = "".join(root.itertext())
        # Normalize whitespace
        full_text = re.sub(r'\s+', ' ', full_text)
        
        # Regex for NDC
        # Look for "NDC" followed optionally by punctuation, then the pattern
        # Pattern: 4-5 digits, hyphen, 3-4 digits, hyphen, 1-2 digits
        # Allow spaces around hyphens just in case
        ndc_pattern = re.compile(r'NDC\W*?(\d{4,5}\s*-\s*\d{3,4}\s*-\s*\d{1,2})', re.IGNORECASE)
        
        text_ndcs = set()
        for match in ndc_pattern.finditer(full_text):
            # Normalize the match (remove spaces)
            clean_ndc = re.sub(r'\s+', '', match.group(1))
            text_ndcs.add(clean_ndc)
            
        print(f"Text NDCs: {sorted(list(text_ndcs))}")
        
        # Combined
        combined = sorted(list(oid_ndcs.union(text_ndcs)))
        print(f"Combined: {combined}\n")

    except Exception as e:
        print(f"Error: {e}")

files = glob.glob('tmp/*.xml') + glob.glob('data/uploads/*.xml')
for f in files:
    test_extract(f)
