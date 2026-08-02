import pandas as pd
import numpy as np
import sys, re, os
from selenium import webdriver
from selenium.webdriver.chrome.service import Service
import time
from datetime import date, datetime
from zoneinfo import ZoneInfo
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.chrome.options import Options
from webdriver_manager.chrome import ChromeDriverManager

## define folder paths
basedir = os.path.dirname(os.path.abspath(__file__))
template_file = os.path.join(basedir, 'Source/Testing_Template_11152022_norm.xlsx')
test_dir = os.path.join(basedir, 'testing_result/')
out_dir = os.path.join(basedir, 'full_report/')

## init ChromeDriver Server
path = os.path.join(basedir, "Source/chromedriver-linux64/chromedriver")
s = Service(executable_path=path)

# options = webdriver.ChromeOptions()
chrome_options = Options()
chrome_options.add_argument('--headless')  # Or '--headless=new' for newer Chrome
chrome_options.add_argument('--disable-gpu')
chrome_options.add_argument('--no-sandbox')
chrome_options.add_argument('--disable-dev-shm-usage')
chrome_options.add_argument('--disable-extensions')
chrome_options.add_argument('--remote-debugging-port=9222')  # Optional: helps with debugging
chrome_options.add_argument('--ignore-certificate-errors')  # This replaces 'acceptInsecureCerts' capability

## Load the testing template
df = pd.read_excel(template_file, header=0).fillna('')
df['server']=''
for ind, d in df.iterrows():
    if 'test' in d['Version']:
        df.loc[ind, 'server']='TEST'
    elif 'dev' in d['Version']:
        df.loc[ind, 'server']='DEV'
    else:
        df.loc[ind, 'server']='PROD'
        
    if 'FDA' in d['Version']:
        df.loc[ind, 'ver']='FDA'
    elif 'CDER' in d['Version']:
        df.loc[ind, 'ver']='CDER-CBER'
    else:
        df.loc[ind, 'ver']='PUBLIC'
		
## main program

# The current report.
df_all = pd.read_excel(out_dir + 'current_testing_report.xlsx')

for rep in range(2):
    print('Running', rep)
    df_res = []
    testing_date = datetime.now(ZoneInfo("America/Chicago")).strftime('%Y/%m/%d, %H:%M')
    testing_date_output = re.sub(r'[\/:]','-', re.sub(r'[,\s]+','_',testing_date))
    curr_details=''
    display = False
    i = 0
    for ind, d in df.iterrows():
        cur = time.time() 
        if d['Query Details'] != '':
            curr_details = d['Query Details']
        if 'http' in d['Result Link']: # valid url
            i +=1
            if display:
                print('')
                print('Task(', ind, '):', curr_details, '[', d['Version'],']')   
            curr_url = d['Result Link']
            try:
                driver = webdriver.Chrome(service=s, options=chrome_options)
                driver.get(curr_url) 
            except Exception as e:
                print(curr_url, 'not working:', e)
                df_res.append([i, d['server'], d['ver'], curr_url, f'Connect Problem: {e}', 
                               'NA', testing_date, curr_details, d['Notes'], 'NA'])
                continue
            
            content='loading'
            time.sleep(1)
            while 'loading' in content.lower():
                if time.time()-cur > 120:
                    break
                try:
                    content = driver.find_element(By.CLASS_NAME,'span4').text
                    content_full = driver.find_element(By.CLASS_NAME,'span12').text
                    time.sleep(0.1)
                except:
                    print(curr_url, 'can not be loaded.')
                    # print(driver.find_element(By.CLASS_NAME,'span12').text)
                    content = 'Error! '+curr_url
                    content_full = 'NA'
                    break
            used_time = time.time()-cur
            # print(used_time, content)
            if content != 'loading':    
                if display:
                    print('    -    Done. Result: ', content, ';')
                    print('    -    Used time:', np.round(used_time, 1),'seconds')
                df_res.append([i, d['server'], d['ver'], curr_url, content, 
                               np.round(used_time, 1), testing_date, curr_details, d['Notes'], content_full])
            else:
                print('    -    TimeOut; Skip this task')
                df_res.append([i, d['server'], d['ver'], curr_url, content, 
                               np.round(used_time, 1), testing_date, curr_details, d['Notes'], content_full])

    df_res = pd.DataFrame.from_records(df_res)
    df_res.columns=['#Task','Server','Version','URL','Query Results','Result Time (Minimum 1s)',
                    'Query_Date', 'Query Details', 'Notes',
                    'Full Contents (For Advanced USE)']
    df_res.to_excel(test_dir+'result_'+testing_date_output+'.xlsx',index=None)

    df_all = pd.concat((df_all, df_res))
    # time.sleep(np.random.randint(60,80))


# Keep the history record
df_all.drop(['Full Contents (For Advanced USE)'],axis=1).sort_values(['Query_Date','#Task']).to_excel(out_dir + 'current_testing_report'+testing_date_output+'.xlsx',index=None)
# update the current report
df_all.drop(['Full Contents (For Advanced USE)'],axis=1).sort_values(['Query_Date','#Task']).to_excel(out_dir + 'current_testing_report.xlsx',index=None)
# df_all.shape