import os
import requests
import pandas as pd
import streamlit as st

st.set_page_config(
    page_title="World Cup 2026 Intelligence",
    page_icon="⚽",
    layout="wide"
)

WAREHOUSE_ID = "fc03329efedbeaa3"
ENDPOINT_NAME = "databricks-meta-llama-3-3-70b-instruct"


# ---------- Styling ----------
st.markdown("""
<style>
.block-container {
    padding-top: 2rem;
    max-width: 1300px;
}

.hero {
    padding: 32px;
    border-radius: 24px;
    background: linear-gradient(135deg, #111827, #064E3B);
    border: 1px solid rgba(255,255,255,0.12);
    margin-bottom: 25px;
}

.hero h1 {
    font-size: 48px;
    margin-bottom: 6px;
}

.hero p {
    color: #D1D5DB;
    font-size: 18px;
}

.metric-card {
    padding: 20px;
    border-radius: 18px;
    background-color: #111827;
    border: 1px solid rgba(255,255,255,0.12);
}

.metric-label {
    color: #9CA3AF;
    font-size: 14px;
}

.metric-value {
    font-size: 28px;
    font-weight: 800;
}

.answer-box {
    padding: 22px;
    border-radius: 18px;
    background-color: #0F172A;
    border: 1px solid rgba(34,197,94,0.45);
    line-height: 1.6;
}
</style>
""", unsafe_allow_html=True)


# ---------- Helpers ----------
def get_workspace_url():
    workspace_url = os.getenv("DATABRICKS_HOST")

    if not workspace_url:
        raise Exception("DATABRICKS_HOST environment variable not found.")

    if not workspace_url.startswith("http"):
        workspace_url = "https://" + workspace_url

    return workspace_url


def get_token():
    token = os.getenv("DATABRICKS_TOKEN")

    if not token:
        raise Exception("DATABRICKS_TOKEN environment variable not found.")

    return token


def query_table(query):
    workspace_url = get_workspace_url()
    token = get_token()

    response = requests.post(
        f"{workspace_url}/api/2.0/sql/statements",
        headers={"Authorization": f"Bearer {token}"},
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

    if result["status"]["state"] != "SUCCEEDED":
        raise Exception(result)

    columns = [
        c["name"]
        for c in result["manifest"]["schema"]["columns"]
    ]

    rows = result["result"]["data_array"]

    return pd.DataFrame(rows, columns=columns)


def ask_llm(prompt):
    workspace_url = get_workspace_url()
    token = get_token()

    response = requests.post(
        f"{workspace_url}/serving-endpoints/{ENDPOINT_NAME}/invocations",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "messages": [
                {
                    "role": "user",
                    "content": prompt
                }
            ],
            "max_tokens": 900
        },
        timeout=60
    )

    if response.status_code != 200:
        raise Exception(response.text)

    return response.json()["choices"][0]["message"]["content"]


@st.cache_data(ttl=300)
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
        LIMIT 15
    """)

    top_scorers = query_table("""
        SELECT
          player,
          team,
          goals
        FROM gold_top_scorers
        ORDER BY goals DESC, player ASC
        LIMIT 15
    """)

    stadiums = query_table("""
        SELECT
          stadium_name,
          city,
          country,
          matches_hosted
        FROM gold_stadium_match_load
        ORDER BY matches_hosted DESC
        LIMIT 15
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
        LIMIT 20
    """)

    return power_rankings, top_scorers, stadiums, group_difficulty, predictions


# ---------- UI ----------
st.markdown("""
<div class="hero">
  <h1>⚽ World Cup 2026 Intelligence Copilot</h1>
  <p>Built with Databricks Lakehouse, Gold Tables, MLflow-style predictions, and Llama 3.3 70B.</p>
</div>
""", unsafe_allow_html=True)

try:
    power_rankings, top_scorers, stadiums, group_difficulty, predictions = load_tables()

    # ---------- Metrics ----------
    col1, col2, col3, col4 = st.columns(4)

    with col1:
        st.markdown(f"""
        <div class="metric-card">
          <div class="metric-label">Top Favorite</div>
          <div class="metric-value">{power_rankings.iloc[0]["team"]}</div>
        </div>
        """, unsafe_allow_html=True)

    with col2:
        st.markdown(f"""
        <div class="metric-card">
          <div class="metric-label">Golden Boot Leader</div>
          <div class="metric-value">{top_scorers.iloc[0]["player"]}</div>
        </div>
        """, unsafe_allow_html=True)

    with col3:
        st.markdown(f"""
        <div class="metric-card">
          <div class="metric-label">Most Used Stadium</div>
          <div class="metric-value">{stadiums.iloc[0]["stadium_name"]}</div>
        </div>
        """, unsafe_allow_html=True)

    with col4:
        st.markdown(f"""
        <div class="metric-card">
          <div class="metric-label">Hardest Group</div>
          <div class="metric-value">Group {group_difficulty.iloc[0]["group_name"]}</div>
        </div>
        """, unsafe_allow_html=True)

    st.divider()

    # ---------- Copilot ----------
    st.subheader("🤖 Ask the World Cup Copilot")

    question = st.text_area(
        "Ask a question",
        "Who are the favorites to win the World Cup and why?"
    )

    if st.button("Ask Copilot", use_container_width=True):
        context = f"""
POWER RANKINGS:
{power_rankings.to_string(index=False)}

TOP SCORERS:
{top_scorers.to_string(index=False)}

STADIUM MATCH LOAD:
{stadiums.to_string(index=False)}

GROUP DIFFICULTY:
{group_difficulty.to_string(index=False)}

MATCH PREDICTIONS:
{predictions.to_string(index=False)}
"""

        prompt = f"""
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

        with st.spinner("Analyzing World Cup data..."):
            answer = ask_llm(prompt)

        st.markdown("### Copilot Answer")
        st.markdown(f"""
        <div class="answer-box">
        {answer}
        </div>
        """, unsafe_allow_html=True)

    st.divider()

    # ---------- Tables ----------
    st.subheader("📊 Tournament Intelligence")

    tab1, tab2, tab3, tab4, tab5 = st.tabs([
        "Power Rankings",
        "Golden Boot",
        "Stadiums",
        "Group Difficulty",
        "Predictions"
    ])

    with tab1:
        st.dataframe(power_rankings, use_container_width=True, hide_index=True)

    with tab2:
        st.dataframe(top_scorers, use_container_width=True, hide_index=True)

    with tab3:
        st.dataframe(stadiums, use_container_width=True, hide_index=True)

    with tab4:
        st.dataframe(group_difficulty, use_container_width=True, hide_index=True)

    with tab5:
        st.dataframe(predictions, use_container_width=True, hide_index=True)

except Exception as e:
    st.error("Something failed.")
    st.code(str(e))
