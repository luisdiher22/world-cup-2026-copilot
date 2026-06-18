import os
import requests
import pandas as pd
import streamlit as st
from databricks import sql

st.set_page_config(
    page_title="World Cup 2026 Copilot",
    layout="wide"
)

st.title("FIFA World Cup 2026™ Copilot")
st.caption("Powered by Databricks Lakehouse + Llama 3.3 70B")

server_hostname = os.getenv("DATABRICKS_HOST")
http_path = st.text_input("/sql/1.0/warehouses/fc03329efedbeaa3")
access_token = os.getenv("DATABRICKS_TOKEN")

def query_table(query):
    with sql.connect(
        server_hostname=server_hostname.replace("https://", ""),
        http_path=http_path,
        access_token=access_token
    ) as connection:
        with connection.cursor() as cursor:
            cursor.execute(query)
            return cursor.fetchall_arrow().to_pandas()

st.sidebar.header("Ask the World Cup")

question = st.sidebar.text_area(
    "Question",
    "Who are the favorites to win the World Cup?"
)

if st.sidebar.button("Ask"):
    power_rankings = query_table("""
        SELECT world_rank, team, group_name, ROUND(team_strength, 2) AS team_strength, title_contender_tier
        FROM gold_power_rankings
        ORDER BY world_rank
        LIMIT 10
    """)

    top_scorers = query_table("""
        SELECT player, team, goals
        FROM gold_top_scorers
        ORDER BY goals DESC
        LIMIT 10
    """)

    context = f"""
    POWER RANKINGS:
    {power_rankings.to_string(index=False)}

    TOP SCORERS:
    {top_scorers.to_string(index=False)}
    """

    prompt = f"""
    You are a World Cup 2026 analytics assistant.
    Use ONLY this data context.
    Do not invent facts.

    {context}

    QUESTION:
    {question}
    """

    workspace_url = os.getenv("DATABRICKS_HOST")
    token = os.getenv("DATABRICKS_TOKEN")

    response = requests.post(
        f"{workspace_url}/serving-endpoints/databricks-meta-llama-3-3-70b-instruct/invocations",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "messages": [
                {"role": "user", "content": prompt}
            ],
            "max_tokens": 1000
        }
    )

    if response.status_code == 200:
        answer = response.json()["choices"][0]["message"]["content"]
        st.subheader("Copilot Answer")
        st.write(answer)
    else:
        st.error(response.text)

st.divider()

st.subheader("Power Rankings")
st.dataframe(
    query_table("""
        SELECT world_rank, team, group_name, ROUND(team_strength, 2) AS team_strength, title_contender_tier
        FROM gold_power_rankings
        ORDER BY world_rank
        LIMIT 15
    """),
    use_container_width=True
)

st.subheader("Golden Boot Race")
st.dataframe(
    query_table("""
        SELECT player, team, goals
        FROM gold_top_scorers
        ORDER BY goals DESC
        LIMIT 15
    """),
    use_container_width=True
)
