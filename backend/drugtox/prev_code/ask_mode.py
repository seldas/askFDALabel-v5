import pandas as pd
import numpy as np
import re, os
from call_llm import *

from xml.etree import ElementTree as ET
from datetime import datetime
from collections import defaultdict

# Constant:
# this is to provide a second match if the provided section code has not been found in the document; however the title matched.
title_dict = {'34086-9':'ABUSE SECTION', '60555-0':'ACCESSORIES', '34084-4':'ADVERSE REACTIONS SECTION', '69761-5':'ALARMS', '34091-9':'ANIMAL PHARMACOLOGY & OR TOXICOLOGY SECTION', '60556-8':'ASSEMBLY OR INSTALLATION INSTRUCTIONS', '34066-1':'BOXED WARNING SECTION', '60557-6':'CALIBRATION INSTRUCTIONS', '34083-6':'CARCINOGENESIS & MUTAGENESIS & IMPAIRMENT OF FERTILITY SECTION', '60558-4':'CLEANING, DISINFECTING, AND STERILIZATION INSTRUCTIONS', '34090-1':'CLINICAL PHARMACOLOGY SECTION', '34092-7':'CLINICAL STUDIES SECTION', '90374-0':'CLINICAL TRIALS EXPERIENCE SECTION', '69760-7':'COMPATIBLE ACCESSORIES', '60559-2':'COMPONENTS', '34070-3':'CONTRAINDICATIONS SECTION', '34085-1':'CONTROLLED SUBSTANCE SECTION', '34087-7':'DEPENDENCE SECTION', '34089-3':'DESCRIPTION SECTION', '69758-1':'DIAGRAM OF DEVICE', '69763-1':'DISPOSAL AND WASTE HANDLING', '34068-7':'DOSAGE & ADMINISTRATION SECTION', '43678-2':'DOSAGE FORMS & STRENGTHS SECTION', '34074-5':'DRUG & OR LABORATORY TEST INTERACTIONS SECTION', '42227-9':'DRUG ABUSE AND DEPENDENCE SECTION', '34073-7':'DRUG INTERACTIONS SECTION', '50742-6':'ENVIRONMENTAL WARNING SECTION', '77291-3':'FEMALES & MALES OF REPRODUCTIVE POTENTIAL SECTION', '50743-4':'FOOD SAFETY WARNING SECTION', '34072-9':'GENERAL PRECAUTIONS SECTION', '34082-8':'GERIATRIC USE SECTION', '50740-0':'GUARANTEED ANALYSIS OF FEED SECTION', '71744-7':'HEALTH CARE PROVIDER LETTER SECTION', '69719-3':'HEALTH CLAIM SECTION', '88829-7':'HEPATIC IMPAIRMENT SUBSECTION', '88437-9':'HOW SUPPLIED & STORAGE & HANDLING SECTION', '34069-5':'HOW SUPPLIED SECTION', '88830-5':'IMMUNOGENICITY', '51727-6':'INACTIVE INGREDIENT SECTION', '34067-9':'INDICATIONS & USAGE SECTION', '50744-2':'INFORMATION FOR OWNERS/CAREGIVERS SECTION', '34076-0':'INFORMATION FOR PATIENTS SECTION', '59845-8':'INSTRUCTIONS FOR USE SECTION', '60560-0':'INTENDED USE OF THE DEVICE', '34079-4':'LABOR & DELIVERY SECTION', '34075-2':'LABORATORY TESTS SECTION', '77290-5':'LACTATION SECTION', '43679-0':'MECHANISM OF ACTION SECTION', '49489-8':'MICROBIOLOGY SECTION', '43680-8':'NONCLINICAL TOXICOLOGY SECTION', '34078-6':'NONTERATOGENIC EFFECTS SECTION', '34080-2':'NURSING MOTHERS SECTION', '55106-9':'OTC - ACTIVE INGREDIENT SECTION', '50569-3':'OTC - ASK DOCTOR SECTION', '50568-5':'OTC - ASK DOCTOR/PHARMACIST SECTION', '50570-1':'OTC - DO NOT USE SECTION', '50565-1':'OTC - KEEP OUT OF REACH OF CHILDREN SECTION', '53414-9':'OTC - PREGNANCY OR BREAST FEEDING SECTION', '55105-1':'OTC - PURPOSE SECTION', '53413-1':'OTC - QUESTIONS SECTION', '50566-9':'OTC - STOP USE SECTION', '50567-7':'OTC - WHEN USING SECTION', '60561-8':'OTHER SAFETY INFORMATION', '34088-5':'OVERDOSAGE SECTION', '51945-4':'PACKAGE LABEL.PRINCIPAL DISPLAY PANEL', '88436-1':'PATIENT COUNSELING INFORMATION', '68498-5':'PATIENT MEDICATION INFORMATION SECTION', '34081-0':'PEDIATRIC USE SECTION', '43681-6':'PHARMACODYNAMICS SECTION', '66106-6':'PHARMACOGENOMICS SECTION', '43682-4':'PHARMACOKINETICS SECTION', '90375-7':'POSTMARKETING EXPERIENCE SECTION', '42232-9':'PRECAUTIONS SECTION', '42228-7':'PREGNANCY SECTION', '43683-2':'RECENT MAJOR CHANGES SECTION', '34093-5':'REFERENCES SECTION', '87523-7':'REMS ADMINISTRATIVE INFORMATION', '87526-0':'REMS APPLICANT REQUIREMENTS', '82344-3':'REMS COMMUNICATION', '82348-4':'REMS ELEMENTS', '82345-0':'REMS ELEMENTS TO ASSURE SAFE USE', '82349-2':'REMS GOALS', '82350-0':'REMS IMPLEMENTATION SYSTEM', '82346-8':'REMS MATERIAL', '82598-4':'REMS MEDICATION GUIDE', '87525-2':'REMS PARTICIPANT REQUIREMENTS', '87524-5':'REMS REQUIREMENTS', '82347-6':'REMS SUMMARY', '82352-6':'REMS TIMETABLE FOR SUBMISSION ASSESSMENTS', '88828-9':'RENAL IMPAIRMENT SUBSECTION', '53412-3':'RESIDUE WARNING SECTION', '69759-9':'RISKS', '60562-6':'ROUTE, METHOD AND FREQUENCY OF ADMINISTRATION', '50741-8':'SAFE HANDLING WARNING SECTION', '48779-3':'SPL INDEXING DATA ELEMENTS SECTION', '48780-1':'SPL LISTING DATA ELEMENTS SECTION', '42231-1':'SPL MEDGUIDE SECTION', '42230-3':'SPL PATIENT PACKAGE INSERT SECTION', '69718-5':'STATEMENT OF IDENTITY SECTION', '44425-7':'STORAGE AND HANDLING SECTION', '60563-4':'SUMMARY OF SAFETY AND EFFECTIVENESS', '38056-8':'SUPPLEMENTAL PATIENT MATERIAL', '34077-8':'TERATOGENIC EFFECTS SECTION', '69762-3':'TROUBLESHOOTING', '43684-0':'USE IN SPECIFIC POPULATIONS SECTION', '54433-8':'USER SAFETY WARNINGS SECTION', '50745-9':'VETERINARY INDICATIONS SECTION', '43685-7':'WARNINGS AND PRECAUTIONS SECTION', '34071-1':'WARNINGS SECTION'} #not used: '42229-5':'SPL UNCLASSIFIED SECTION'

def ask_mode(message, prompt, meta):
    mode = meta['mode']
    
    if mode in ('M1', 'M2', 'M3', 'M4', 'M5'): # 
        if mode == 'M3':
            info = 'Special Mode 3: Biomarker identification.'
        elif mode in ('M2',):
            info = 'Special Mode 2: DILI Classification.'
        elif mode == 'M1':
            info = 'Special Mode 1: Drug AE Profiling.'
        elif mode == 'M4':
            info = 'Special Mode 2: DICT Classification.'
        elif mode == 'M5':
            info = 'Special Mode 2: DIRI Classification.'
            
        res =  call_sections(message, prompt, meta)

    return res
    
def call_sections(message, prompt, meta):
    max_token = meta['max_token']
    
    section_used = meta['section_used']
    if not section_used:
        print('Will use the whole labeling document.')

    # XML processing
    df_result = meta['df_labeling']
    final_res = [] # initialize the return value

    if df_result.shape[0] == 0:
        # answer = 'No Labeling was found for the query! Please double check the drug name.'
        return pd.DataFrame()
            
    section_dict = defaultdict(list)
    nms = {'xmlns':'urn:hl7-org:v3'}
    for ind, d in df_result.iterrows():
        reference = d.drop('XML')
        
        ### Separate target sections
        spl_doc = ET.fromstring(d['XML'])
            
        # Search all possible sections
        for curr_section in section_used:
            section_text = spl_doc.find(".//xmlns:section/xmlns:code[@code='"+curr_section+"']/..", nms)
            if section_text:
                section_text = ET.tostring(section_text, method='text').decode('ISO8859-1')
                curr_answer = call_llm(section_text, prompt, max_token)
            else:
                title = title_dict[curr_section].upper()
                section_text = spl_doc.find(".//xmlns:section/[xmlns:title='"+title+"']/..", nms)
                if section_text:
                    section_text = ET.tostring(section_text, method='text').decode('ISO8859-1')
                    curr_answer = call_llm(section_text, prompt, max_token)
                else:
                    curr_answer = f'No Section: {curr_section}'
            
            final_res.append([curr_section, curr_answer, reference, section_text])

    final_res = pd.DataFrame(final_res, columns = ['curr_section', 'section_answer', 'reference', 'section_text'])
    return final_res # stop after the first labeling was checked.