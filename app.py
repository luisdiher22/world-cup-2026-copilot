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
    power_rankings, top_scorers, stadiums, groups = load_context_tables(http_path)

    col1, col2, col3, col4 = st.columns(4)

    with col1:
        st.markdown(f"""
        <div class="card">
          <div class="metric-title">Top Favorite</div>
          <div class="metric-value">{power_rankings.iloc[0]["team"]}</div>
        </div>
        """, unsafe_allow_html=True)

    with col2:
        st.markdown(f"""
        <div class="card">
          <div class="metric-title">Golden Boot Leader</div>
          <div class="metric-value">{top_scorers.iloc[0]["player"]}</div>
        </div>
        """, unsafe_allow_html=True)

    with col3:
        st.markdown(f"""
        <div class="card">
          <div class="metric-title">Most Used Stadium</div>
          <div class="metric-value">{stadiums.iloc[0]["stadium_name"]}</div>
        </div>
        """, unsafe_allow_html=True)

    with col4:
        st.markdown(f"""
        <div class="card">
          <div class="metric-title">Hardest Group</div>
          <div class="metric-value">Group {groups.iloc[0]["group_name"]}</div>
        </div>
        """, unsafe_allow_html=True)

    if st.sidebar.button("Ask Copilot", use_container_width=True):
        context = f"""
POWER RANKINGS:
{power_rankings.to_string(index=False)}

TOP SCORERS:
{top_scorers.to_string(index=False)}

STADIUM MATCH LOAD:
{stadiums.to_string(index=False)}

GROUP DIFFICULTY:
{groups.to_string(index=False)}
"""

        prompt = f"""
You are a FIFA World Cup 2026 analytics assistant.

Use ONLY the supplied data.
Do not invent facts.
If the answer cannot be determined from the context, say so clearly.

CONTEXT:
{context}

QUESTION:
{question}

Answer clearly, analytically, and concisely.
"""

        with st.spinner("Analyzing World Cup data..."):
            answer = ask_llm(prompt)

        st.markdown("## Copilot Answer")
        st.markdown(f"""
        <div class="answer-box">
        {answer}
        </div>
        """, unsafe_allow_html=True)

    st.markdown("## Tournament Intelligence")

    tab1, tab2, tab3, tab4 = st.tabs([
        "Power Rankings",
        "Golden Boot",
        "Stadiums",
        "Groups"
    ])

    with tab1:
        st.dataframe(power_rankings, use_container_width=True, hide_index=True)

    with tab2:
        st.dataframe(top_scorers, use_container_width=True, hide_index=True)

    with tab3:
        st.dataframe(stadiums, use_container_width=True, hide_index=True)

    with tab4:
        st.dataframe(groups, use_container_width=True, hide_index=True)

except Exception as e:
    st.error("Something failed.")
    st.code(str(e))
