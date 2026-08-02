# Elsa intro
## Model details
here are two models and IDs that can be used in elsa

Model Name	Engine ID
Claude Sonnet 4.6	8405ac40-89c6-4613-848c-3d89986fbc01
Claude Haiku 4.5	2184831d-a67d-44f7-974e-95fa92003af9

## introduction
ELSA API is REST Endpoint https://<HostName>/Monolith/api/engine/runPixel with a POST method. It requires Basic Authorization with Username as the Access Key and Password as the Secret Key, with a header as application/x-www-form-urlencoded.  The payload requires to have a key as expression and value needs be to of the below structure.
LLM(engine="<model_engine_id>", command = "<encode>what is the capital of France ?</encode>", context = "<system prompt>", useHistory=<history boolean>, paramValues = [<param map>])
•	engine: The unique identifier of the LLM engine/model to use. Provided by administrator
•	command: The main prompt or question for the LLM
•	context: (Optional) System-level prompt or instructions for the LLM.
•	useHistory: (Optional) Boolean (true/false). If true, includes previous chat history for context. Default is true.
•	paramValues: (Optional) Map of additional parameters: 
o	temperature: randomness of response
o	max_completion_tokens: maximum number of tokens in response

## Response format

Field	Sample Value	Description
insightID	TempInsight_d7a8d394-814d-4842-985c-ccedecc7124c	Unique session identifier for tracking
pixelReturn[0].pixelId	0	Sequential query number in session
pixelReturn[0]. pixelExpression	LLM (engine = \"7bd59c7b-92d6-4bc9-91eb-4d17f74b5b3f\", command = \"<encode>what does FDA Do?</encode>\", paramValues = [{ 'max_completion_tokens' : 2000 , 'temperature' : 0 . 3 } ] ) ;	Input expression Payload provided by the user
pixelReturn[0].isMeta	FALSE	Indicates this is not metadata/system info
pixelReturn[0].timeToRun	11987	Processing time in milliseconds (~12 seconds)
pixelReturn[0]. Output.numberOfTokensInPrompt	12	Input query size in tokens
pixelReturn[0]. Output.numberOfTokensInResponse	301	Actual response size in tokens
pixelReturn[0]. Output.messageType	CHAT	Type of interaction
pixelReturn[0]. Output.response	The FDA (Food and Drug Administration) is a federal agency within the U.S. Department of Health and Human Services that protects and promotes public health. Here are its main responsibilities:\n\n## **Food Safety**\n- Regulates food safety and labeling\n- Inspects food facilities and imports\n- Sets standards for food additives and contaminants\n- Oversees dietary supplements\n\n## **Drug Regulation**\n- Reviews and approves new prescription and over-the-counter medications\n- Monitors drug safety and effectiveness\n- Regulates clinical trials\n- Oversees drug manufacturing quality\n\n## **Medical Devices**\n- Approves medical devices (from bandages to pacemakers)\n- Ensures device safety and effectiveness\n- Regulates device manufacturing\n\n## **Other Key Areas**\n- **Tobacco products** - regulates manufacturing, marketing, and distribution\n- **Cosmetics** - oversees safety and labeling\n- **Blood products** - ensures safety of blood supply\n- **Vaccines** - works with CDC on vaccine safety monitoring\n\n## **Enforcement Powers**\n- Can recall dangerous products\n- Inspect facilities\n- Issue warning letters\n- Pursue legal action against violators\n\nThe FDA's mission is essentially to ensure that products Americans consume and use for health are safe and effective before they reach the market, and to continue monitoring them afterward.	Response from the LLM Model
pixelReturn[0]. Output.roomId	TempInsight_d7a8d394-814d-4842-985c-ccedecc7124c	Chat room/session ID (matches insightID)
pixelReturn[0]. Output.messageId	4865af2b-c0a7-49d1-9b65-9224870db3b1	Unique identifier for this specific response
pixelReturn[0].operationType	OPERATION	Type of operation performed

## Sample Python Code
import requests
from urllib.parse import quote, quote_plus, urlencode
import json

#Dev
username="<access_key>"
password="<secret_key>"

question = 'What does FDA do?'

def llm_query(question, username="", password=""):
  """Simple LLM query function"""

  command = f'''LLM(engine = "<model_engine_id>", command = "<encode>{question}</encode>", paramValues = [{{"max_completion_tokens": 2000, "temperature": 0.3}}])'''

  response = requests.post(
    "https://elsa-dev.preprod.fda.gov/Monolith/api/engine/runPixel",
    headers={"Content-Type": "application/x-www-form-urlencoded"},
    data=f'expression={quote_plus(command)}',
    auth=(username, password)
  )

  if response.status_code == 200:
    output = {'response':json.loads(response.text)['pixelReturn'][0]['output'],'error':{}}
  else:
    output = {'response':{'numberOfTokensInResponse': 0, 'numberOfTokensInPrompt': 0, 'messageType': '', 'response':''},'error': 'An error while processing the request'}
  return output

# Usage
print(llm_query(question,username,password))
