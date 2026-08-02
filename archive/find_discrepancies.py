import pandas as pd
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import cross_val_predict
import numpy as np

def find_discrepancies():
    # 1. Load data
    input_path = r'data\downloads\ALT_update_latest.xlsx'
    df = pd.read_excel(input_path)
    
    # We need to map 'vDILIConcern' or 'Toxicity Class'.
    # Mask valid rows instead of dropping to preserve the original spreadsheet when saving back
    mask = df['Toxicity Class'].notna() & df['AI Summary'].notna()
    df_valid = df[mask].copy()
    
    if len(df_valid) == 0:
        print("No valid rows found.")
        return

    # 2. Convert text to TF-IDF features
    vectorizer = TfidfVectorizer(stop_words='english', ngram_range=(1, 2))
    X = vectorizer.fit_transform(df_valid['AI Summary'])
    y = df_valid['Toxicity Class']
    
    # 3. Train a lightweight Logistic Regression model and get its predictions
    # cross_val_predict ensures the model predicts on data it wasn't trained on
    model = LogisticRegression(max_iter=1000)
    
    try:
        df_valid['Predicted_Class'] = cross_val_predict(model, X, y, cv=3)
        probs = cross_val_predict(model, X, y, cv=3, method='predict_proba')
        max_probs = np.max(probs, axis=1)
    except Exception as e:
        print("Error during cross validation:", e)
        # fallback to simple train/predict on same set if cross validation fails due to class imbalance
        model.fit(X, y)
        df_valid['Predicted_Class'] = model.predict(X)
        probs = model.predict_proba(X)
        max_probs = np.max(probs, axis=1)
        
    # 4. Find the discrepancies and assign tags
    def determine_endpoint(row):
        actual = str(row['Toxicity Class'])
        predicted = str(row['Predicted_Class'])
        
        if actual == predicted:
            return 'Agree'
            
        actual_is_no = 'No' in actual
        pred_is_no = 'No' in predicted
        
        if actual_is_no != pred_is_no:
            return 'Disagree'
        else:
            return 'Fuzzy'
            
    df_valid['endpoint'] = [determine_endpoint(row) for _, row in df_valid.iterrows()]
    
    def determine_explanation(row):
        actual = str(row['Toxicity Class'])
        predicted = str(row['Predicted_Class'])
        
        if row['endpoint'] == 'Agree':
            return 'Model prediction matches the assigned class.'
        elif row['endpoint'] == 'Fuzzy':
            return f"Minor severity difference: predicted {predicted} (actual: {actual})."
        else:
            return f"Major mismatch: predicted {predicted} instead of {actual}."
            
    df_valid['Explanations'] = df_valid.apply(determine_explanation, axis=1)
    
    # Add new columns to the original dataframe
    df['endpoint'] = ''
    df['Explanations'] = ''
    
    df.loc[mask, 'endpoint'] = df_valid['endpoint']
    df.loc[mask, 'Explanations'] = df_valid['Explanations']
    
    # Export back to original Excel file, overwriting it
    df.to_excel(input_path, index=False)
    
    discrepancies_count = len(df_valid[df_valid['endpoint'] != 'Agree'])
    print(f"Found {discrepancies_count} discrepancies (Fuzzy/Disagree) out of {len(df_valid)} valid rows.")
    print(f"Overwrote {input_path} with new columns 'endpoint' and 'Explanations'. No CSV or separate report generated.")

if __name__ == '__main__':
    find_discrepancies()
