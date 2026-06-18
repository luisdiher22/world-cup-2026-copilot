import os
import requests
import pandas as pd
import streamlit as st
from databricks import sql

st.set_page_config(
    page_title="World Cup 2026 Intelligence",
    page_icon="⚽",
    layout="wide"
)

st.markdown("""
<style>
.main {
    background-color: #0B0F19;
}
.block-container {
    padding-top: 2rem;
    padding-bottom: 2rem;
    max-width: 1300px;
}
.hero {
    padding: 32px;
    border-radius: 24px;
    background: linear-gradient(135deg, #111827 0%, #1F2937 50%, #064E3B 100%);
    border: 1px solid rgba(255,255,255,0.12);
    margin-bottom: 28px;
}
.hero h1 {
    font-size: 52px;
    margin-bottom: 8px;
}
.hero p {
    font-size: 18px;
    color: #D1D5DB;
}
.card {
    padding: 22px;
    border-radius: 20px;
    background-color: #111827;
    border: 1px solid rgba(255,255,255,0.10);
    margin-bottom: 18px;
}
.metric-title {
    color: #9CA3AF;
    font-size: 14px;
}
.metric-value {
    font-size: 32px;
    font-weight: 800;
}
.answer-box {
    padding: 24px;
    border-radius: 20px;
    background-color: #0F172A;
    border: 1px solid rgba(34,197,94,0.45);
    font-size: 17px;
    line-height: 1.6;
}
</style>
""", unsafe_allow_html=True)

st.markdown("""
<div class="hero">
  <h1>⚽ World Cup 2026 Intelligence Copilot</h1>
  <p>Databricks Lakehouse + Gold Tables + Llama 3.3 70B</p>
</div>
""", unsafe_allow_html=True)

server_hostname = os.getenv("DATABRICKS_HOST", "").replace("https://", "")
access_token = os.getenv("DATABRICKS_TOKEN")

http_path = st.sidebar.text_input(
    "SQL Warehouse HTTP Path",
    value="/sql/1.0/warehouses/fc03329efedbeaa3"
)

question = st.sidebar.text_area(
    "Ask the World Cup",
    "Who are the favorites to win the World Cup?"
)

def query_table(query):
    with sql.connect(
        server_hostname=server_hostname,
        http_path=http_path,
        access_token=access_token
    ) as connection:
        with connection.cursor() as cursor:
            cursor.execute(query)
            return cursor.fetchall_arrow().to_pandas()

@st.cache_data(ttl=300)
def load_context_tables(http_path):
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

    stadiums = query_table("""
        SELECT stadium_name, city, country, matches_hosted
        FROM gold_stadium_match_load
        ORDER BY matches_hosted DESC
        LIMIT 10
    """)

    groups = query_table("""
        SELECT group_name, avg_group_strength, strongest_team_score
        FROM gold_group_difficulty
        ORDER BY avg_group_strength DESC
    """)

    return power_rankings, top_scorers, stadiums, groups

def ask_llm(prompt):
    workspace_url = os.getenv("DATABRICKS_HOST")
    token = os.getenv("DATABRICKS_TOKEN")

    response = requests.post(
        f"{workspace_url}/serving-endpoints/databricks-meta-llama-3-3-70b-instruct/invocations",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "messages": [
                {"role": "user", "content": prompt}
            ],
            "max_tokens": 900
        },
        timeout=60
    )

    if response.status_code != 200:
        raise Exception(response.text)

    return response.json()["choices"][0]["message"]["content"]

try:
    st.write("Testing SQL connection...")

    test_df = query_table("""
        SELECT 1 AS test_value
    """)

    st.success("SQL connection works!")
    st.dataframe(test_df)

except Exception as e:
    st.error("SQL test failed.")
    st.code(str(e))
