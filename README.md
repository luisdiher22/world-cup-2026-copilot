# World Cup 2026 Intelligence Copilot

A FastAPI web app that surfaces FIFA World Cup 2026 analytics — power rankings, group standings, top scorers, stadium load, and match predictions — backed by Databricks gold tables, with an AI chat assistant for asking questions about the data.

## Features

- Dashboard with tabs for overview, power rankings, standings, golden boot, schedule, bracket, and stadiums
- Live ticker with tournament highlights
- Chat assistant that answers questions grounded only in the loaded Databricks tables (no hallucinated stats)
- In-memory caching of query results to avoid hitting the SQL warehouse on every request

## Tech stack

- **Backend:** FastAPI, Uvicorn, pandas
- **Data source:** Databricks SQL Statement Execution API
- **LLM:** Databricks Model Serving (`databricks-meta-llama-3-3-70b-instruct`), streamed via Server-Sent Events
- **Frontend:** Jinja2 templates, vanilla JS/CSS

## Project structure

```
app.py              # FastAPI app: Databricks queries, caching, chat streaming, routes
templates/index.html  # Dashboard UI
static/css, static/js # Styling and frontend logic
app.yaml             # Run command for Databricks Apps deployment
requirements.txt     # Python dependencies
```

## Setup

1. Install dependencies:

   ```bash
   pip install -r requirements.txt
   ```

2. Set the required environment variables (see below).

3. Run the app:

   ```bash
   python app.py
   ```

   The server starts on `http://localhost:8000` (or the port set by `DATABRICKS_APP_PORT`).

## Environment variables

| Variable | Description |
| --- | --- |
| `DATABRICKS_HOST` | Databricks workspace URL |
| `DATABRICKS_TOKEN` | Personal access token used to call the SQL Statement Execution API and the model serving endpoint |
| `DATABRICKS_APP_PORT` | Port to run the app on (defaults to `8000`) |

> The Databricks workspace URL, warehouse ID, and access token must not be hardcoded in source. Keep credentials in a local `.env` file (already excluded via `.gitignore`) or in your deployment environment's secret store.

## API endpoints

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/` | Renders the dashboard |
| `GET` | `/api/data` | Returns all gold tables as JSON (power rankings, top scorers, stadiums, group difficulty, predictions, match details, team match history) |
| `POST` | `/api/chat` | Streams an AI-generated answer (SSE) to a question about the tournament data |

## Deployment

This app is configured to run on Databricks Apps via `app.yaml`, which simply invokes `python app.py`.
