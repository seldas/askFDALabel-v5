How to use externally with OpenAI API
Direct Client Setup (without sdk)

python

Copy
from openai import OpenAI

# access key + secret key format
client = OpenAI(
    api_key="<accesskey>:<secretkey>",
    base_url="https://elsa-dev.preprod.fda.gov/Monolith/api/model/openai"
)
Chat Completions (without sdk)

python

Copy
response = client.chat.completions.create(
    model="8405ac40-89c6-4613-848c-3d89986fbc01",
    messages=[
        {"role": "system", "content": "You are a helpful assistant."},
        {"role": "user", "content": "Who won the world series in 2020?"}
    ]
)
print(response.choices[0].message.content)
Responses API (without sdk)

python

Copy
response = client.responses.create(
    model="8405ac40-89c6-4613-848c-3d89986fbc01",
    instructions="You are a helpful assistant.",
    input="Who won the world series in 2020?"
)
print(response.output[0].text)
Legacy Completions (Deprecated by OpenAI, without sdk)

python

Copy
response = client.completions.create(
    model="8405ac40-89c6-4613-848c-3d89986fbc01",
    prompt="Write a tagline for an ice cream shop.",
    extra_body={"insight_id":"<optional insight id>"}
)
Embeddings (without sdk)

python

Copy
embeddings = client.embeddings.create(
    model="8405ac40-89c6-4613-848c-3d89986fbc01",
    input=["Your text string goes here"]
)
Client Setup (with sdk)

SDK package: ai-server-sdk on PyPI

python

Copy
# Requires user access/secret, service account, or bearer token
import ai_server
server_connection=ai_server.ServerClient(
    base="https://elsa-dev.preprod.fda.gov/Monolith/api",
    access_key="<your access key>",
    secret_key="<your secret key>"
)

# Configure the OpenAI client to route through this Semoss instance
from openai import OpenAI
import httpx as httpx
http_client = httpx.Client()
http_client.cookies=server_connection.cookies

client = OpenAI(
    api_key="EMPTY",
    base_url=server_connection.get_openai_endpoint(),
    default_headers=server_connection.get_auth_headers(),
    http_client=http_client
)
Chat Completions (with sdk)

python

Copy
response = client.chat.completions.create(
    model="8405ac40-89c6-4613-848c-3d89986fbc01",
    messages=[
        {"role": "system", "content": "You are a helpful assistant."},
        {"role": "user", "content": "Who won the world series in 2020?"},
        {"role": "assistant", "content": "The Los Angeles Dodgers won the World Series in 2020."},
        {"role": "user", "content": "Where was it played?"}
    ],
    # Only difference vs a standard OpenAI call: pass the current insight id in extra_body.
    extra_body={"insight_id":server_connection.cur_insight}
)
Responses API (with sdk)

python

Copy
response = client.responses.create(
    model="8405ac40-89c6-4613-848c-3d89986fbc01",
    instructions="You are a helpful assistant.",
    input="Who won the world series in 2020?",
	# Only difference vs a standard OpenAI call: pass the current insight id in extra_body.
    extra_body={"insight_id":server_connection.cur_insight}
)
print(response.output[0].text)
Legacy Completions (Deprecated by OpenAI, with sdk)

python

Copy
response = client.completions.create(
    model="8405ac40-89c6-4613-848c-3d89986fbc01",
    prompt="Write a tagline for an ice cream shop.",
    # Only difference vs a standard OpenAI call: pass the current insight id in extra_body.
    extra_body={"insight_id":server_connection.cur_insight}
)
Embeddings (with sdk)

python

Copy
embeddings = client.embeddings.create(
    model="8405ac40-89c6-4613-848c-3d89986fbc01",
    input=["Your text string goes here"],
    # Only difference vs a standard OpenAI call: pass the current insight id in extra_body.
    extra_body={"insight_id":server_connection.cur_insight}
)