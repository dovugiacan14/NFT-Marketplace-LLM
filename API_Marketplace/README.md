# API Marketplace (Dataset Description Generator)

FastAPI service that generates dataset descriptions from a title, original description, and uploaded CSV files. Uses an LLM wrapper (`llm.py`) with optional 4-bit quantization (fallback when bitsandbytes is unavailable) and a lightweight pipeline in `autoddg.py`.

## Features
- Dataset description generation from CSV samples.
- Multipart upload: accepts multiple CSVs.
- Optional 4-bit quantization; auto-fallback if bitsandbytes missing (common on Windows).
- Auto-reload dev server with exclude pattern for sample data.

## Project Structure
```
API_Marketplace/
├── api.py         # FastAPI app (lifespan init)
├── autoddg.py     # Dataset description pipeline
├── llm.py         # LLM wrapper (bnb fallback)
├── db.py          # FAISS/DB helpers
├── test_file/     # Sample CSVs (ignored by reload)
└── README.md
```

## Requirements
- Python 3.8+ (pyproject pins 3.14+)
- CUDA-capable GPU recommended (RTX 3060 works). CPU fallback possible but slower.
- Hugging Face token (for model download).

## Setup
```bash
git clone <repository-url>
cd API_Marketplace
poetry install
```

Create `.env`:
```
HUGGINGFACE_TOKEN=your_hf_token
```
(Add DB vars if you extend FAISS/Neo4j usage.)

## Run (dev, auto-reload, exclude sample data)
```bash
poetry run uvicorn api:app --host 0.0.0.0 --port 8000 --reload --reload-exclude "test_file/*"
```
Docs: http://localhost:8000/docs

## Endpoint
### POST `/generate_description`
Multipart form fields:
- `title`: string (required)
- `original_description`: string (required)
- `csv_files`: file[] (one or more CSV uploads, required)

Example:
```bash
curl -X POST "http://localhost:8000/generate_description" \
  -H "accept: application/json" \
  -H "Content-Type: multipart/form-data" \
  -F "title=Customer Churn" \
  -F "original_description=Telco churn dataset" \
  -F "csv_files=@./test_file/netflix_titles.csv;type=text/csv"
```

## Notes on quantization
- 4-bit (BitsAndBytesConfig) used when `bitsandbytes` backend is available.
- On Windows, bitsandbytes often unavailable; code auto-falls back to non-quantized load.

## Testing
No pytest wiring included. You can hit the endpoint with `curl` or write smoke tests using `requests`/`httpx`.

## Troubleshooting
- `uvicorn` not found: ensure `poetry install` and use `poetry run uvicorn ...`.
- Extra argument errors: keep `--reload-exclude "test_file/*"` on the same line; no stray paths.
- Bitsandbytes errors on Windows: expected; fallback will load without 4-bit.

