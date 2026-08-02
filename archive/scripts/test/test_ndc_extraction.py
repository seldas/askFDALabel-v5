import xml.etree.ElementTree as ET
import glob
import os

def test_extract(file_path):
    print(f"--- Testing {file_path} ---")
    try:
        tree = ET.parse(file_path)
        root = tree.getroot()
        ns = {'spl': 'urn:hl7-org:v3'}
        
        # 1. NDC Strategy: Global Search by OID
        ndcs = set()
        # Find all elements with codeSystem attribute
        # Note: XPath with namespace and attribute
        # .//spl:*[@codeSystem='...'] might not work in standard ET.
        # We might need to iterate all elements.
        
        for elem in root.iter():
            # Check for NDC OID
            if elem.get('codeSystem') == '2.16.840.1.113883.6.69':
                code = elem.get('code')
                if code:
                    ndcs.add(code)
            
            # Check for App Num OID (root attribute on id tag)
            # Usually <id root="..." extension="...">
            if elem.get('root') == '2.16.840.1.113883.3.150':
                ext = elem.get('extension')
                if ext:
                    print(f"Found App Num: {ext}")

        print(f"Found NDCs: {sorted(list(ndcs))}")

    except Exception as e:
        print(f"Error: {e}")

files = glob.glob('tmp/*.xml') + glob.glob('data/uploads/*.xml')
for f in files:
    test_extract(f)
