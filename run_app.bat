@echo off
rem ChainSleuth AML - local run helper.
rem Starts the FastAPI backend (port 8000) and the Next.js frontend (port 3001)
rem in two windows. Close both windows to stop.
start "chainsleuth-backend" cmd /k python -m uvicorn backend.main:app --port 8000
start "chainsleuth-frontend" cmd /k "cd frontend && bun dev --port 3001"
echo Backend:  http://localhost:8000
echo Frontend: http://localhost:3001
