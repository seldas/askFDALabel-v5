import os
import json
import oracledb
import re
from dotenv import load_dotenv

# Load env from backend/.env
env_path = os.path.join(os.path.dirname(__file__), '../.env')
load_dotenv(env_path)

def build_trie(word_list):
    trie = {}
    for word in word_list:
        if not word: continue
        w = word.strip()
        if not w: continue
        node = trie
        # Store as lowercase for case-insensitive matching
        for char in w.lower():
            node = node.setdefault(char, {})
        node['#'] = 1  # Use a flag (1) instead of storing the full word to save space
    return trie

# Common medical/labeling terms that are NOT drug names
BLACKLIST = {
    "human", "animal", "treatment", "injection", "infusion", "tablet", "capsule", "solution", 
    "suspension", "ointment", "cream", "gel", "lotion", "spray", "inhaler", "powder", 
    "system", "product", "medicine", "medication", "dose", "dosage", "strength", "active", 
    "ingredient", "purpose", "uses", "warning", "warnings", "directions", "information", 
    "other", "questions", "daily", "oral", "topical", "sterile", "release", "extended", 
    "delayed", "standard", "generic", "brand", "name", "hand", "sanitizer", "soap", 
    "wash", "clean", "antiseptic", "antibacterial", "first", "aid", "kit", "unit", 
    "pack", "refill", "alcohol", "water", "liquid", "skin", "body", "relief", "maximum",
    "extra", "plus", "ultra", "advanced", "original", "formula", "concentrated", "kit",
    "swab", "patch", "film", "strip", "vial", "ampule", "bottle", "container", "pump",
    "aerosol", "foam", "gas", "oil", "paste", "suppository", "douche", "enema",
    "shampoo", "conditioner", "toothpaste", "mouthwash", "vitamin", "vitamins",
    "supplement", "dietary", "nutrition", "natural", "organic", "daily"
}

def clean_and_split_names(name_list, is_rld=False):
    refined = set()
    # Pattern to detect any character that is NOT a letter, a space, or a hyphen
    invalid_char_pattern = re.compile(r'[^a-zA-Z\s\-]')
    
    for name in name_list:
        if not name: continue
        name = name.strip().strip('-')
        
        # 2. Skip if it contains numbers, special characters, or subname delimiters
        if not name or invalid_char_pattern.search(name):
            continue
            
        # 2. Skip if it contains " AND " (case-insensitive) suggesting multiple drugs
        if re.search(r'\s+and\s+', name, flags=re.IGNORECASE):
            continue
            
        # 3. Skip if it contains 2 or more spaces
        if name.count(' ') >= 3:
            continue
            
        # 4. Skip if in blacklist
        lower_name = name.lower()
        if lower_name in BLACKLIST:
            continue
            
        # 4. Length check
        min_len = 3 if is_rld else 5
        
        if len(name) >= min_len:
            refined.add(name)

        name_sub = re.split(' ', name)[0]
        if name_sub != name:
            refined.add(name_sub)

    return refined

def fetch_drug_names_split(method='file'):
    rld_refined = set()
    brand_refined = set()
    
    if method == 'file':
        # 1. Load RLD names (High Priority, lenient filtering)
        rld_path = os.path.join(os.path.dirname(__file__), 'rld_drug_name.txt')
        if os.path.exists(rld_path):
            print(f"Loading RLD names from {rld_path}...")
            try:
                with open(rld_path, 'r', encoding='latin-1') as f:
                    rld_lines = [line.strip() for line in f if line.strip() and line.strip() != "Drug Name"]
                rld_refined = clean_and_split_names(rld_lines, is_rld=True)
                print(f"Added {len(rld_refined)} terms from RLD list.")
            except Exception as e:
                print(f"Error reading RLD file: {e}")

        # 2. Load Distinct names (Secondary Priority, strict filtering)
        distinct_path = os.path.join(os.path.dirname(__file__), 'distinct_drug_name.txt')
        if os.path.exists(distinct_path):
            print(f"Loading Distinct names from {distinct_path}...")
            try:
                with open(distinct_path, 'r', encoding='latin-1') as f:
                    distinct_lines = [line.strip() for line in f if line.strip() and line.strip() != "Drug Name"]
                
                # Apply strict filtering (min_len=5)
                brand_refined = clean_and_split_names(distinct_lines, is_rld=False)
                
                # Exclude names already in RLD (case-insensitive)
                rld_lower = {n.lower() for n in rld_refined}
                brand_refined = {n for n in brand_refined if n.lower() not in rld_lower}
                
                print(f"Added {len(brand_refined)} unique terms from Distinct list.")
            except Exception as e:
                print(f"Error reading Distinct file: {e}")

    # Fallback to DB if both files are empty or missing
    if not rld_refined and not brand_refined:
        serv = os.getenv("FDALabel_HOST") or os.getenv("FDALabel_SERV")
        port = os.getenv("FDALabel_PORT") or "1521"
        app_name = os.getenv("FDALabel_SERVICE") or os.getenv("FDALabel_APP")
        user = os.getenv("FDALabel_USER")
        psw = os.getenv("FDALabel_PASSWORD") or os.getenv("FDALabel_PSW")
        schema = os.getenv("FDALABEL_SCHEMA", "DRUGLABEL")

        if not all([serv, port, app_name, user, psw]):
            print("Missing DB credentials in .env")
            return [], []

        dsn = oracledb.makedsn(serv, port, app_name)
        try:
            conn = oracledb.connect(user=user, password=psw, dsn=dsn)        
            
            # RLD
            raw_names = set()
            cursor = conn.cursor()
            cursor.execute(f"SELECT DISTINCT PRODUCT_NAMES FROM {schema}.DGV_SUM_SPL s join {schema}.sum_spl_rld rld on rld.spl_id = s.spl_id")
            for row in cursor.fetchall():
                if row[0]: raw_names.add(row[0])
            cursor = conn.cursor()
            cursor.execute(f"SELECT DISTINCT ACT_INGR_NAMES FROM {schema}.DGV_SUM_SPL s join {schema}.sum_spl_rld rld on rld.spl_id = s.spl_id")
            for row in cursor.fetchall(): # no combined drugs
                if row[0]: 
                    raw_names.add(row[0])
            rld_refined = clean_and_split_names(raw_names, is_rld=True)

            # other active ingredients
            raw_names = set()          
            cursor = conn.cursor()
            cursor.execute(f"SELECT DISTINCT ACT_INGR_NAMES FROM {schema}.DGV_SUM_SPL")
            for row in cursor.fetchall(): # no combined drugs
                if row[0]: 
                    raw_names.add(row[0].upper())
            conn.close()
            brand_refined = clean_and_split_names(raw_names, is_rld=False)
        except Exception as e:
            print(f"Error connecting to DB: {e}")
    
    print(f"RLD terms: {len(rld_refined)}, BRAND terms: {len(brand_refined)}")
    return list(rld_refined), list(brand_refined)

def generate():
    rld_drugs, brand_drugs = fetch_drug_names_split(method='db')
    
    if not rld_drugs and not brand_drugs:
        print("No drugs found, using minimal fallback list.")
        rld_drugs = ["Triumeq", "CALQUENCE", "KRAZATI", "ALECENSA", "Olumiant"]
        brand_drugs = ["Ibuprofen", "Aspirin", "Metformin", "Atorvastatin", "Amoxicillin"]
    
    print(f"RLD terms: {len(rld_drugs)}, BRAND terms: {len(brand_drugs)}")
    
    data = {
        "rld": build_trie(rld_drugs),
        "brand": build_trie(brand_drugs)
    }
    
    # Path to frontend public dir
    output_dir = os.path.join(os.path.dirname(__file__), '../frontend/public/snippets/drug-snippet')
    if not os.path.exists(output_dir):
        os.makedirs(output_dir)
    
    # Read the logic file
    logic_path = os.path.join(output_dir, 'snippet_logic.js')
    logic_content = ""
    if os.path.exists(logic_path):
        with open(logic_path, 'r', encoding='utf-8') as f:
            logic_content = f.read()
    else:
        print(f"Warning: {logic_path} not found. Only data will be generated.")

    # Combine data and logic
    final_content = f"var DRUG_SNIPPET_DATA = {json.dumps(data, ensure_ascii=False)};\n\n{logic_content}"
    
    output_path = os.path.join(output_dir, 'drug_snippet.js')
    
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(final_content)
    print(f"Success: drug_snippet.js generated in {output_path}")

if __name__ == "__main__":
    generate()
