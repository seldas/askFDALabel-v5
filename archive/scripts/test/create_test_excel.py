from openpyxl import Workbook
wb = Workbook()
ws = wb.active
columns = ['Labeling Type', 'Dosage Form(s)', 'Route(s) of Administration', 'Marketing Category', 'Application Number(s)', 'Trade Name', 'Generic/Proper Name(s)', 'SPL Effective Date (YYYY/MM/DD)', 'Established Pharmacologic Class(es)', 'Initial U.S. Approval', 'Company', 'Marketing Date(s) (YYYY/MM/DD)', 'NDC(s)', 'Active Ingredient UNII(s)', 'Active Ingredient(s)', 'Active Moiety Name(s)', 'Active Moiety UNII(s)', 'FDALabel Link', 'DailyMed SPL Link', 'DailyMed PDF Link', 'SET ID']
ws.append(columns)
ws.append(['HUMAN PRESCRIPTION DRUG LABEL', 'TABLET', 'ORAL', 'ANDA', '070929', 'Test Drug', 'TEST DRUG', '2025/12/18', 'Test Class', None, 'TEST CO', '2011/08/15-', '0000-0000', 'UNII123', 'TEST DRUG', 'TEST', 'UNII456', 'link', 'link', 'link', '9b8a4211-120f-4981-ad69-928accb97637'])
wb.save('test_import.xlsx')
