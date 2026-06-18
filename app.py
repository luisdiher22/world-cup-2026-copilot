import os
import json
import time
import threading

import httpx
import requests
import pandas as pd
import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel

load_dotenv()

WAREHOUSE_ID = "fc03329efedbeaa3"
ENDPOINT_NAME = "databricks-meta-llama-3-3-70b-instruct"
CACHE_TTL_SECONDS = 300

app = FastAPI(title="World Cup 2026 Intelligence Copilot")
app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

_cache = {"tables": None, "timestamp": 0.0}
_cache_lock = threading.Lock()


# ---------- Databricks helpers ----------
def get_workspace_url():
    workspace_url = "https://dbc-31524534-7920.cloud.databricks.com"

    if not workspace_url:
        raise Exception("DATABRICKS_HOST environment variable not found.")

    if not workspace_url.startswith("http"):
        workspace_url = "https://" + workspace_url

    return workspace_url


def get_token():
    token = "dapi1572ae641ad2e6f3e459a3023881318f"

    if not token:
        raise Exception("DATABRICKS_TOKEN environment variable not found.")

    return token


def query_table(query, poll_timeout_seconds=180, poll_interval_seconds=2):
    workspace_url = get_workspace_url()
    token = get_token()
    headers = {"Authorization": f"Bearer {token}"}

    response = requests.post(
        f"{workspace_url}/api/2.0/sql/statements",
        headers=headers,
        json={
            "warehouse_id": WAREHOUSE_ID,
            "statement": query,
            "wait_timeout": "30s",
            "on_wait_timeout": "CONTINUE"
        },
        timeout=45
    )

    if response.status_code != 200:
        raise Exception(response.text)

    result = response.json()
    statement_id = result["statement_id"]

    deadline = time.time() + poll_timeout_seconds
    while result["status"]["state"] in ("PENDING", "RUNNING"):
        if time.time() >= deadline:
            raise Exception(f"Statement {statement_id} timed out while warehouse was starting up")

        time.sleep(poll_interval_seconds)

        response = requests.get(
            f"{workspace_url}/api/2.0/sql/statements/{statement_id}",
            headers=headers,
            timeout=45
        )

        if response.status_code != 200:
            raise Exception(response.text)

        result = response.json()

    if result["status"]["state"] != "SUCCEEDED":
        raise Exception(result)

    columns = [
        c["name"]
        for c in result["manifest"]["schema"]["columns"]
    ]

    rows = result["result"]["data_array"]

    return pd.DataFrame(rows, columns=columns)


def load_tables():
    power_rankings = query_table("""
        SELECT
          world_rank,
          team,
          group_name,
          ROUND(team_strength, 2) AS team_strength,
          title_contender_tier
        FROM gold_power_rankings
        ORDER BY world_rank
        
    """)

    top_scorers = query_table("""
        SELECT
          player,
          team,
          goals
        FROM gold_top_scorers
        ORDER BY goals DESC, player ASC
        
    """)

    stadiums = query_table("""
        SELECT
          stadium_name,
          city,
          country,
          matches_hosted
        FROM gold_stadium_match_load
        ORDER BY matches_hosted DESC
        
    """)

    group_difficulty = query_table("""
        SELECT
          group_name,
          avg_group_strength,
          strongest_team_score
        FROM gold_group_difficulty
        ORDER BY avg_group_strength DESC
    """)

    predictions = query_table("""
        SELECT
          local_date,
          group_name,
          home_team,
          away_team,
          predicted_result,
          ROUND(confidence_score, 2) AS confidence_score,
          insight_type,
          ai_match_analysis
        FROM gold_ai_match_analysis
        ORDER BY confidence_score DESC
        
    """)

    return {
        "power_rankings": power_rankings,
        "top_scorers": top_scorers,
        "stadiums": stadiums,
        "group_difficulty": group_difficulty,
        "predictions": predictions,
    }


def get_cached_tables():
    with _cache_lock:
        is_stale = (time.time() - _cache["timestamp"]) >= CACHE_TTL_SECONDS
        if _cache["tables"] is None or is_stale:
            _cache["tables"] = load_tables()
            _cache["timestamp"] = time.time()
        return _cache["tables"]


def build_prompt(tables, question):
    context = f"""
POWER RANKINGS:
{tables["power_rankings"].to_string(index=False)}

TOP SCORERS:
{tables["top_scorers"].to_string(index=False)}

STADIUM MATCH LOAD:
{tables["stadiums"].to_string(index=False)}

GROUP DIFFICULTY:
{tables["group_difficulty"].to_string(index=False)}

MATCH PREDICTIONS:
{tables["predictions"].to_string(index=False)}
"""

    return f"""
You are a FIFA World Cup 2026 analytics assistant.

Use ONLY the supplied Databricks table context.
Do not invent facts.
If the data does not contain enough information, say that clearly.

CONTEXT:
{context}

QUESTION:
{question}

Answer clearly, analytically, and concisely.
"""


async def stream_chat_tokens(prompt):
    workspace_url = get_workspace_url()
    token = get_token()
    url = f"{workspace_url}/serving-endpoints/{ENDPOINT_NAME}/invocations"

    payload = {
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": 900,
        "stream": True,
    }

    async with httpx.AsyncClient(timeout=60) as client:
        async with client.stream(
            "POST",
            url,
            headers={"Authorization": f"Bearer {token}"},
            json=payload,
        ) as response:
            if response.status_code != 200:
                body = await response.aread()
                yield f"data: {json.dumps({'error': body.decode()})}\n\n"
                return

            async for line in response.aiter_lines():
                if not line or not line.startswith("data:"):
                    continue

                data = line[len("data:"):].strip()
                if data == "[DONE]":
                    break

                try:
                    chunk = json.loads(data)
                except json.JSONDecodeError:
                    continue

                delta = chunk.get("choices", [{}])[0].get("delta", {}).get("content")
                if delta:
                    yield f"data: {json.dumps({'token': delta})}\n\n"

    yield "data: [DONE]\n\n"


class ChatRequest(BaseModel):
    question: str


# ---------- Routes ----------
@app.get("/", response_class=HTMLResponse)
def index(request: Request):
    return templates.TemplateResponse(request, "index.html")


@app.get("/api/data")
def get_data():
    try:
        tables = get_cached_tables()
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)

    return {
        key: df.to_dict(orient="records")
        for key, df in tables.items()
    }


@app.post("/api/chat")
async def chat(payload: ChatRequest):
    try:
        tables = get_cached_tables()
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)

    prompt = build_prompt(tables, payload.question)
    return StreamingResponse(stream_chat_tokens(prompt), media_type="text/event-stream")


if __name__ == "__main__":
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=int(os.environ.get("DATABRICKS_APP_PORT", 8000)),
    )
