--To incorporate technological advances, which top AI features would you like to add in the future (next 2-5 years)? 

Analyze, extract, compare information across designated EPC classes 
A function export Warnings and Precautions from selected labeling documents.
Same for devices
A search function could be useful for identifying labels with a certain characteristic, like "Which currently-approved labeling documents recommend a higher dose in pediatric patients compared to adults?“
determine if reported preferred terms (e.g., from FAERS search results) are labeled for given product(s); summarize relevant labeling sections for use in a review Word document; compare/contrast labeling status of specific event(s) across a drug class; Ways to use FDALabel and Elsa together 
I would like to be able to ask AI to show me labels for a specific active, brand and generic, and identify differences between the labeling documents with text first and later with graphics on the PDP, and export the results so I can review prior work
a function to export the application numbers in a format that could be pasted into a Search360 search
query a chatbot about a class or indication; e.g. what are common warnings in x class etc. ability to easily visualize reciprocal drug interactions, or lack of reciprocity.
concerned that search results with AI will need verification (making them nearly useless) vs hard coded search of structured data where results are what they are
I don't see a need to add AI functions to FDALabel which I will need to verify with source documents (like comparing labels or summarizing AE info) because this will not improve efficiency or accuracy of my work. I could see a potential application of an AI search function to quickly identify relevant labeling based on similarity and synonyms to a search query of interest (OTS, Q11)

--Why do you like FDALabel and do you have any suggestions or comments to improve the tool?

I like being able to search specific sections of the label for certain terms/phrases. (OND)
It is very efficient to find relevant approved/marketed products across different categories. (OPQ)
It is flexible and allows me to get granular in my searches. (OND)
Great resource for doing labeling reviews and promotional communication review. (OMP)
Best way to identify labels in a class, or evaluate if an AE is commonly reported in a class etc. (OND)
It's capability to find all products having similar functions. (OPQ)
The option for more than one entry for Labeling section (i.e., more than one search term in more than one labeling section) as another way to refine results. (OSE)
I like that I can search specific sections for a specific word or concept and see what has been written in approved labelings. (OND)
Labeling sections for drugs with Pharmacogenomics information for decision making along with FDA approved tests in labeling. (OTS)
I think FDA label is a great way to look at precedents across the divisions and I focus on 8.4 to try and ensure we are being consistent. (OND)
I value FDALabel CDER-CBER version to give me the landscape of how clinical outcome assessments were used in Section 14 clinical studies for a given product. This landscape overview helps me see how assessments were used in clinical divisions that I do not typically work in. It helps me to create consistency in our advice to sponsors. (OND)
To assess what adverse events are labeled across drugs particularly across drugs used in specific specialties (e.g., oncology, hematology), consistency in labeling. (OSE)
My collaborators use this important tools for seeking information on various drugs and their adverse effects. (NCTR)
We have used FDALabel in the past to investigate different opioid-based drugs as well as antibiotics. (NCTR)

## Implementation Status (February 2026)

### ✅ Completed Features
- **FAERS AE Profile Analysis**: Implemented a two-phase background task system to fetch and aggregate Adverse Event data from openFDA. Includes MedDRA hierarchy mapping (SOC -> PT) and trend visualization.
- **Label Comparison Engine**: Developed a side-by-side comparison tool for SPL (XML) and internal JSON formats, allowing users to identify differences in specific labeling sections with highlighting.
- **Section Export Function**: Capability to export specific labeling sections (e.g., Warnings & Precautions) from selected documents into structured formats.

## 🚀 Accelerated AI Roadmap (Next 2 Months)

### Month 1: Core Analysis & Trust
- [ ] **Device Labeling Support**: Extend the export and comparison logic to medical device labeling documents.
- [ ] **Pediatric vs. Adult Dosing Search**: Implement specialized AI filters to identify labels with specific pediatric dosing recommendations vs. adult counterparts.
- [ ] **AI-Driven Similarity Search**: Enhance the search engine to use vector embeddings for identifying relevant labels based on clinical synonyms and concept similarity (e.g., Q11/OTS).
- [ ] **Verification Logic**: Implement "Trust but Verify" UI components that link AI-generated summaries directly to verbatim source text in the SPL to mitigate hallucinations.

### Month 2: Advanced Visuals & Integrations
- [ ] **Word Document Summarization**: Add functionality to summarize labeling sections directly into a pre-formatted Word document for regulatory review.
- [ ] **Reciprocal Drug Interaction Visualization**: Create interactive maps to visualize complex drug-drug interaction networks.
- [ ] **PDP Graphic Comparison**: Extend label comparison to include graphical elements from the Principal Display Panel (PDP).
- [ ] **Search360 Integration**: Automated export of application numbers in formats compatible with Search360.
