import pandas as pd
import numpy as np
import re, os
from call_llm import *

import oracledb
from xml.etree import ElementTree as ET
from datetime import datetime
from collections import defaultdict

dsnStr = oracledb.makedsn('ncsvmlbldbtst2.fda.gov','1521','lbltst2')
con = oracledb.connect(user='', password='', dsn=dsnStr)
cursor = con.cursor()

def get_label_records(message, mode='M3', drugname=None, top=5):
    cursor=con.cursor()
    if mode in ('M1'): # single labeling document retrieval
        return get_single_label(message, drugname, top=top)
    elif mode in ('M2', 'M4'):
        return get_single_label_tc(message, drugname, top=top)
        
def get_single_label(message, drugname, top):
    # first use exact match if the drugname is specified
    df_result = pd.DataFrame()
    if drugname:
        # the labeling used has to include the Adverse Reaction section; this is a simple checker to ensure the labeling document is valid to use .
        query_exact = f"""
            select l.set_id, l.spl_id, l.product_names, l.AUTHOR_ORG_NORMD_NAME, l.eff_time, s.spl_xml
                from druglabel.sum_spl l
                join druglabel.spl s on s.set_id = l.set_id
                join druglabel.spl_sec on spl_sec.spl_id = l.spl_id
                where (Upper(l.PRODUCT_NAMES) like Upper('{drugname}%') 
                or Upper(l.PRODUCT_NORMD_GENERIC_NAMES) like Upper('{drugname}%'))
                and spl_sec.loinc_code = '34084-4'
                order by l.eff_time desc
            """
        
        results = cursor.execute(query_exact).fetchmany(top) # Only consider the top 1 labeling
        df_result = pd.DataFrame(results, columns= ['SETID', 'SPL_ID', 'Product Name', 'Company', 'SPL Effective Time', 'XML'])
        if df_result.shape[0]:
            df_result['Used_Name'] = drugname
            return df_result
        # print(query_exact, df_result.shape)
        
    # if the drugname is not specified or no exact match records were found;
    if df_result.shape[0] == 0:
        answer, all_names = get_drugname(message) # identify drug name by LLM 

        name_list="'"
        for item in all_names[:5]: # The first/top 5 drug synonyms will be used.
            if re.search(r'[\'\(]', item): # currently we didn't consider special symbols
                continue 
            name_list += "^"+item.strip().upper()+"|"
        name_list=name_list.strip('|')+"'"
        
        query_setids = f"""
            select l.set_id, l.spl_id, l.product_names, l.AUTHOR_ORG_NORMD_NAME, l.eff_time, s.spl_xml
                from druglabel.sum_spl l
                join druglabel.spl s on s.set_id = l.set_id
                join druglabel.spl_sec on spl_sec.spl_id = l.spl_id
                where (REGEXP_LIKE(Upper(l.PRODUCT_NAMES), {name_list}) 
                or REGEXP_LIKE(Upper(l.PRODUCT_NORMD_GENERIC_NAMES), {name_list}))
                and spl_sec.loinc_code = '34084-4'
                order by l.eff_time desc
            """
        results = cursor.execute(query_setids).fetchmany(top) 
        df_result = pd.DataFrame(results, columns= ['SETID', 'SPL_ID', 'Product Name', 'Company', 'SPL Effective Time', 'XML']) # Only consider the top 1 labeling
        df_result['Used_Name'] = name_list
    
        return df_result

def get_single_label_tc(message, drugname, top):
    # first use exact match if the drugname is specified
    df_result = pd.DataFrame()
    if drugname:
        # the labeling used has to include the Adverse Reaction section; this is a simple checker to ensure the labeling document is valid to use .
        # HUMAN PRESCRIPTION and OTC DRUG LABEL
        # Single Ingredient
        # Has initial approval year
        query = f"""
            with table_filtered as (
                select l.set_id, l.spl_id, l.product_names, l.AUTHOR_ORG_NORMD_NAME, l.eff_time, l.revised_date, l.initial_approval_year, s.spl_xml, l.document_type_loinc_code
                    from druglabel.sum_spl l
                    join druglabel.spl s on s.set_id = l.set_id
                    where (Upper(l.PRODUCT_NAMES) like Upper('{drugname}%') 
                    or Upper(l.PRODUCT_NORMD_GENERIC_NAMES) like Upper('{drugname}%'))
                    and l.num_act_ingrs = 1
                    and (l.routes_of_administration like '%ORAL%'
                        or l.routes_of_administration like '%PARENTERAL%'
                        or l.routes_of_administration like '%INTRA%'
                        or l.routes_of_administration like '%SUBCUTANEOUS%'
                        or l.routes_of_administration like '%INJECT%')
                    
            )
            (select set_id, spl_id, product_names, AUTHOR_ORG_NORMD_NAME, eff_time, revised_date, initial_approval_year, spl_xml, document_type_loinc_code
                    from table_filtered
                    where document_type_loinc_code in ('34391-3', '45129-4')
            UNION ALL
            select set_id, spl_id, product_names, AUTHOR_ORG_NORMD_NAME, eff_time, revised_date, initial_approval_year, spl_xml, document_type_loinc_code
                    from table_filtered
                    where document_type_loinc_code in ('34390-5')
                    AND NOT EXISTS (
                        select 1
                            from table_filtered
                            where document_type_loinc_code in ('34391-3', '45129-4')
                    )
            )
            order by eff_time desc, initial_approval_year desc
            """
        
        try:
            results = cursor.execute(query)
        except Exception as e:
            print(query, 'Can not be processed; an error occur:', e)
            result = None
        if results:
            results = results.fetchall()
            df_result = pd.DataFrame(results, columns= ['SETID', 'SPL_ID', 'Product Name', 'Company', 'SPL Effective Time', 'Revised Date','Initial Year', 'XML', 'Document_Type']).head(top)
            if df_result.shape[0]>0:
                df_result['Used_Name'] = drugname
                return df_result
                # print(query_exact, df_result.shape)

    # not using this section for research
    # if the drugname is not specified or no exact match records were found;
    unused_step = '''
    if df_result.shape[0] == 0:
        answer, all_names = get_drugname(message) # identify drug name by LLM 

        name_list="'"
        for item in all_names[:5]: # The first/top 5 drug synonyms will be used.
            if re.search(r'[\'\(\)\"]', item): # currently we didn't consider names with special symbols
                continue 
            name_list += "^"+item.strip().upper()+"|"
        name_list = name_list.strip('|')+"'"
        # print(name_list)
        query = f"""with table_filtered as (
                select l.set_id, l.spl_id, l.product_names, l.AUTHOR_ORG_NORMD_NAME, l.eff_time, l.revised_date, l.initial_approval_year, s.spl_xml, l.document_type_loinc_code
                    from druglabel.sum_spl l
                    join druglabel.spl s on s.set_id = l.set_id
                    where (REGEXP_LIKE(Upper(l.PRODUCT_NAMES), {name_list}) 
                    or REGEXP_LIKE(Upper(l.PRODUCT_NORMD_GENERIC_NAMES), {name_list}))
                    and l.num_act_ingrs = 1
                    and (l.routes_of_administration like '%ORAL%'
                        or l.routes_of_administration like '%PARENTERAL%'
                        or l.routes_of_administration like '%INTRA%'
                        or l.routes_of_administration like '%SUBCUTANEOUS%'
                        or l.routes_of_administration like '%INJECT%')
                    
            )
            (select set_id, spl_id, product_names, AUTHOR_ORG_NORMD_NAME, eff_time, revised_date, initial_approval_year, spl_xml, document_type_loinc_code
                    from table_filtered
                    where document_type_loinc_code in ('34391-3', '45129-4')
            UNION ALL
            select set_id, spl_id, product_names, AUTHOR_ORG_NORMD_NAME, eff_time, revised_date, initial_approval_year, spl_xml, document_type_loinc_code
                    from table_filtered
                    where document_type_loinc_code in ('34390-5')
                    AND NOT EXISTS (
                        select 1
                            from table_filtered
                            where document_type_loinc_code in ('34391-3', '45129-4')
                    )
            )
            order by eff_time desc, initial_approval_year desc
            """
        try:
            results = cursor.execute(query)
        except Exception as e:
            print(query, 'Can not be processed; an error occur:', e)
            result = None
        if results:
            results = results.fetchall()
            df_result = pd.DataFrame(results, columns= ['SETID', 'SPL_ID', 'Product Name', 'Company', 'SPL Effective Time', 'Revised Date', 'Initial Year', 'XML', 'Document_Type']).head(top)
            if df_result.shape[0]>0:
                df_result['Used_Name'] = name_list
                return df_result
    '''
    # else, loose the match criteria to include combined drugs;
    if df_result.shape[0] == 0:
        name_list = drugname
        query = f"""with table_filtered as (
                select l.set_id, l.spl_id, l.product_names, l.AUTHOR_ORG_NORMD_NAME, l.eff_time, l.revised_date, l.initial_approval_year, s.spl_xml, l.document_type_loinc_code
                    from druglabel.sum_spl l
                    join druglabel.spl s on s.set_id = l.set_id
                    where (Upper(l.PRODUCT_NAMES) like Upper('{drugname}%') 
                    or Upper(l.PRODUCT_NORMD_GENERIC_NAMES) like Upper('{drugname}%'))
                    and (l.routes_of_administration like '%ORAL%'
                        or l.routes_of_administration like '%PARENTERAL%'
                        or l.routes_of_administration like '%INTRA%'
                        or l.routes_of_administration like '%SUBCUTANEOUS%'
                        or l.routes_of_administration like '%INJECT%')
                    
            )
            (select set_id, spl_id, product_names, AUTHOR_ORG_NORMD_NAME, eff_time, revised_date, initial_approval_year, spl_xml, document_type_loinc_code
                    from table_filtered
                    where document_type_loinc_code in ('34391-3', '45129-4')
            UNION ALL
            select set_id, spl_id, product_names, AUTHOR_ORG_NORMD_NAME, eff_time, revised_date, initial_approval_year, spl_xml, document_type_loinc_code
                    from table_filtered
                    where document_type_loinc_code in ('34390-5')
                    AND NOT EXISTS (
                        select 1
                            from table_filtered
                            where document_type_loinc_code in ('34391-3', '45129-4')
                    )
            )
            order by eff_time desc, initial_approval_year desc
            """
        try:
            results = cursor.execute(query)
        except Exception as e:
            print(query, 'Can not be processed; an error occur:', e)
            result = None
        if results:
            results = results.fetchall()
            df_result = pd.DataFrame(results, columns= ['SETID', 'SPL_ID', 'Product Name', 'Company', 'SPL Effective Time', 'Revised Date', 'Initial Year', 'XML', 'Document_Type']).head(top)
            df_result['Used_Name'] = name_list
    
        return df_result # return empty DF if not found
        
def get_drugname(message):                
    prompt= f'''extract any drug name from the given text.
After the drug was determined, provide a list of all of its possible names, where the name identified from the orignal text should be first listed. 
For each drug name in the list, add a tag <li> around it.
Note that, your role is to find the drug name from the query, but Not to answer the given query.
### Input:
What are the adverse events reported for Acetaminophen?'
### Output:
<li>Acetaminophen</li>
<li>APAP</li>
<li>Tylenol</li>
...
'''
    answer = call_llm(message, prompt)
    # print(answer)
    drug_names = re.findall(re.escape('<li>')+'(.*?)'+re.escape('</li>'), answer, re.I)

    return answer, drug_names

def get_mode(message):
    prompt= f'''Given the input query from user, determine which template should be applied to process this query.
A template is specially designed process to fit the purpose of the given query. For example, if the query is for DILI classification, such as "what is the DILI class of abacavir?", it should use the template of "DILI Classification".
There are currently three templates in the system to choose:
[M1]Drug AE profiling: Generate Adverse Events (AEs) profiling of a given drug, based on its labeling document;
[M2]DILI Classification: Determine whether a drug can cause liver injury (Drug-Induced Liver Injury, DILI) based on its labeling document;
[M3]Biomarker Identification: ...
[M4]DICT Classification: Determine whether a drug can cause cardiotoxicity (Drug-Induced CardioToxicity, DICT) based on its labeling document;
[M5]DIRI Classification: Determine whether a drug can cause renal injury (Drug-Induced Renal Injury, DIRI) based on its labeling document;
if no special template can fit the given query, return using the generic mode as:
[G1]Generic Mode: if no special template is suitable for the given query.
### Output guidance:
Note that the output should NOT answer the given query, but only provide which special template to use, or using the generic mode.
### Example 1: Input:
What are the adverse events for Acetaminophen?
### Example 1: Output:
[M1]Drug AE profiling
### Example 2: Input:
What is the DILI class of Abacavir?
### Example 2: Output:
[M2]DILI Classification
### Example 2: Input:
What is the DICT class of tamoxifen?
### Example 2: Output:
[M3]DICT Classification

'''
    answer = call_llm(message, prompt)
    # print(answer)
    mode = re.search(r'\[([MG]\d+)\]', answer)
    if mode:
        mode = mode[1]
    else:
        mode = '[G1]'
    return answer, mode

def get_prompt(mode):
    if mode == 'M1':
        prompt = f''' Identify and Extract all reported Adverse Events from the given paragraphs.
The output should follow the format given below:
### Example of Output:
The Adverse Events reported in this section are listed as below:
[AE1]: <context>
[AE2]: <context>
...
'''
    elif mode == 'M2':
        prompt = f''' 
Drug Induced Liver Injury (DILI) is the topic of interest for your study on drug labeling document.
Check the given paragraph to see if any of the following DILI-relevant keywords (or with similar meaning) are mentioned in the paragraph.
if one keyword occurs multiple times in the paragraph, only list once. The output should contain the exact term mentioned in the content.
In addition, determine which severe level of DILI the keyword(s) reflect 
If there is no paragraph or text provided, return "(No Section) No input text was provided"
### Severity determination
The severity of Drug Induced Liver Injury should be determined by the following criteria and scores.
[Score: 8]Fatal liver failure. [Description] Hepatotoxicity: Death; fatal liver failure; or needed liver transplantation. 
[Score: 7]Acute liver failure.	[Description] Liver/hepatic failure; fulminant hepatic necrosis	
[Score: 6]Liver necrosis.	[Description] Histologically confirmed liver necrosis caused by drug; other types of ischemic or necrosis such as injection site necrosis should not count.	
[Score: 5]Jaundice.	[Description] Jaundice (clinically apparent), if caused by drug-induced hepatocellular injury	
[Score: 4]Hyperbilirubinemia.	[Description] Hyperbilirubinemia without visible jaundice, if not due to other causes like Gilbert syndrome or cholestasis	
[Score: 3]liver/hepatic injury.	[Description] Abnormal liver/hepatic function test; liver/hepatic injury; Liver-related aminotransferases increase (e.g. ALT, AST, transaminase, aminotransferase); 	
[Score: 2]Cholestasis; steatohepatitis.	[Description] Steatohepatitis, cholestasis, cholestatic hepatitis; liver/hepatic damage/disorder/impairment/toxicity/reaction; hepatitis; hepatopathy	
[Score: 1]Steatosis.	[Description] Steatosis; fatty liver; 

Also, Liver toxicity terms may occur in the labeling for describing pre-existed conditions of the patient (which is apparently not an adverse event of the drug). For example, "Ask a doctor before use if you have liver cirrhosis, ..." or "Avoid use in patients with hepatic impairment", etc. In such cases, its severity should be categoried as "[Score: 0]Pre-existed Condition". 

### Output format (the answer should be in one line, below include multiple answer examples):
(Found) keyword1; keyword2; [Severity]: [Score: 8]Fatal liver failure
(Found) keyword1; keyword2; [Severity]: [Score: 3]liver/hepatic injury
(Found) keyword1; keyword2; [Severity]: [Score: 0]Pre-existed Condition
(No Keyword) No DILI keyword was identified in the given paragraph
(No Section) No input text was provided
'''
    elif mode == 'M4':
        prompt = f''' 
Drug Induced Cardiotoxicity (DICT) is the topic of interest for your study on drug labeling document.
Check the given paragraph to see if any of the following DICT-relevant terms (or with similar meaning) are mentioned in the paragraph.
if one term occurs multiple times in the paragraph, only list once.
In addition, determine whether the keyword(s) reflect severe events of Drug Induced Cardiotoxicity
If there is no paragraph or text provided, return "(No Section) No input text was provided"
### Severity determination
The severity of Drug Induced Liver Injury should be determined by the following criteria, including three levels (Severe, Moderate, Mild) on two aspects (Heart damage and Arrhythmia).
Severe(Heart damage)	Fatal, life-threatening, death, need heart transplantation, (acute) myocardial infarction, heart attack, heart/cardiac failure, congestive heart failure (CHF), cardiomyopathy, myocarditis, coronary artery disease, myocardial ischemia, left ventricular dysfunction, cardiogenic shock, coronary artery insufficiency, valvular heart disease, endocarditis...
Severe(Arrhythmia)	Fatal, life-threatening, heart/cardiac arrest, cardiorespiratory arrest, torsade de pointes (TdP), AV block III, ventricular fibrillation, Brugada syndrome…
Moderate(Heart damage)	Angina pectoris, increased angina, mitral valve regurgitation, heart valve thickening, cardio spasm…
Moderate(Arrhythmia)	Ventricular tachycardia, long QT syndrome/QT interval prolongation, ventricular arrhythmias…
Mild(Heart damage)	Blood pressure (hypotension/hypertension) …
Mild(Arrhythmia)	AV block I & II, atrial fibrillation, tachycardia/bradycardia, palpitations, sinus node dysfunction…

Also, cardiotoxicity terms may occur in the labeling for describing Pre-existed Conditions of the patient (which is apparently not an adverse event of the drug), such as "Patients with cardiac/heart disorder (ex. acute myocardial infarction…), hypersensitivity reactions, drug interactions, cardiac adverse events in elderly patients...". In such cases, its severity should be categoried as "Pre-existed Condition"

### Output format (the answer should be in one line, below include multiple answer examples):
(Found)  keyword1; keyword2; [Severity]: Severe(Heart damage)
(Found)  keyword1; keyword2; [Severity]: Pre-existed Condition
(No Keyword) No DICT keyword was identified in the given paragraph
(No Section) No input text was provided
'''
    elif mode == 'M5':
        prompt = f''' 
Drug Induced Renal Injury (DIRI) is the topic of interest for your study on drug labeling document.
Check the given paragraph to see if any of the following DIRI-relevant terms (or with similar meaning) are mentioned in the paragraph.
if one term occurs multiple times in the paragraph, only list once.
In addition, determine whether the keyword(s) reflect severe events of Drug Induced Renal Injury.
If there is no paragraph or text provided, return "(No Section) No input text was provided"
### Severity determination
The severity of Drug Induced Renal Injury should be determined by the following criteria, including two levels (Certain, Possible).
[Certain Keywords]
    Renal injury
    Acute kidney injury (AKI)
    Nephrotoxicity
    Glomerulonephritis
    Acute tubular necrosis (ATN)
    Chronic kidney disease (CKD) secondary to drug
    Interstitial nephritis
    Drug-induced nephropathy
    Nephrotic syndrome
    Renal failure
    Nephritis 
    Renal Toxicity 
[Possible Keywords]
    Elevated serum creatinine
    Decreased glomerular filtration rate (GFR)
    Proteinuria
    Hematuria
    Oliguria
    Hyperkalemia
    Pyuria
    Urinary casts
    Increased blood urea nitrogen (BUN)
    Nephrolithiasis - This is the formation of kidney stones
    Renal Impairment / Renal Insufficiency 
    Renal dysfunction 
    Azotemia - This is the accumulation of nitrogenous waste products (such as urea and creatinine) in the blood
    Renal function deterioration - If words like server, moderate, or drastic appear before Renal function deterioration, it would alter the classification to "Certain"

Also, renal toxicity terms may occur in the labeling for describing pre-existed conditions of the patient (which is apparently not an adverse event of the drug). In such cases, its severity should be categoried as "Pre-existed Condition" 

### Output format (the answer should be in one line, below include multiple answer examples):
(Found)  keyword1; keyword2; [Severity]: Certain
(Found)  keyword1; keyword2; [Severity]: Possible
(Found)  keyword1; keyword2; [Severity]: Pre-existed Condition
(No Keyword) No DIRI keyword was identified in the given paragraph
(No Section) No input text was provided
'''
    elif mode == 'G1':
        prompt = f'''Answer the user query with best of your knowledge.
'''
    else: # generic mode by default
        prompt = f'''Answer the user query with best of your knowledge.
'''
    return prompt
