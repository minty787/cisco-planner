# Mesh — Cisco / Cisco Meraki Network Planner

A self-hosted Dockerized planning tool for Cisco Catalyst and Cisco Meraki
deployments. Inspired by the Ubiquiti UniFi Design Center, built for the
Cisco ecosystem.

## Features

- **Device library** — pre-seeded with real Cisco Catalyst and Meraki SKUs
  (MS / MR / MX / MV / MT series, Catalyst 9200/9300/9300X, ISR/Catalyst 8300).
  Add new devices manually or by ingesting vendor datasheet PDFs.
- **PDF datasheet ingestion** — uploads a PDF and parses the specs. Uses local
  regex heuristics by default; if you supply an `ANTHROPIC_API_KEY` it uses
  the Anthropic API for AI-grade structured extraction.
- **Floor plan editor with auto-detection** — uploads a PNG/JPG floor plan
  and runs OpenCV-based detection of walls, doors, and windows. Everything
  is editable: draw walls, mark windows, drop doors, erase anything.
- **WiFi heatmap** — drop access points, get a live RSSI heatmap calculated
  via a log-distance path-loss model accounting for wall and window
  attenuation. Coverage rings shown per AP based on its datasheet radius.
- **Rack planner** — visual 1U-resolution rack with click-to-place device
  picker. Multi-U devices automatically span slots. Tracks capacity and
  power draw.
- **Bill of Materials** — automatic BOM generation across all racks and AP
  placements with totals for cost, power, and rack units. CSV export.
- **Persistent SQLite** — all data stored in a Docker volume.

## Quick Start

```bash
git clone <this-repo> mesh-planner
cd mesh-planner

# (Optional) enable AI PDF ingestion
cp .env.example .env
echo "ANTHROPIC_API_KEY=sk-ant-..." >> .env

docker compose up --build -d
```

Then open <http://localhost:4173>.

Backend API docs are at <http://localhost:8000/docs>.

## Architecture

```
┌────────────────────┐      ┌────────────────────┐
│  React (Vite)      │ ───► │  FastAPI / Python  │
│  port 4173         │      │  port 8000         │
└────────────────────┘      ├────────────────────┤
                            │  OpenCV  (floor)   │
                            │  pypdf   (PDFs)    │
                            │  Anthropic SDK     │
                            │  SQLite  (state)   │
                            └────────────────────┘
                                       │
                            ┌─────── volumes ───────┐
                            │ mesh_data ── DB       │
                            │ mesh_uploads ── files │
                            └───────────────────────┘
```

## Adding New Devices

Three ways:

1. **UI manual entry** — Device Library → "+ Add Device".
2. **PDF datasheet upload** — Device Library → "↑ Ingest PDF Datasheet".
   Without an API key, regex parsing extracts SKU, vendor, family, WiFi
   standard, rack units, and PoE budget. With an API key, all schema fields
   are extracted with high accuracy.
3. **Direct SQL** — the SQLite file is at `mesh_data/planner.db` inside the
   Docker volume. Insert rows into the `device` table.

## Floor Plan Tips

- Architectural plans with solid black lines and standard door-arc
  conventions detect best.
- Set the scale (metres per pixel) using a known dimension on your plan to
  get accurate AP coverage rings and heatmap dB falloff.
- If auto-detect goes wild, use the **Clear all features** button and trace
  walls manually with the WALL tool.

## WiFi Modelling Caveats

The heatmap uses a log-distance path-loss model with fixed per-wall
attenuation. It's a planning aid, not a replacement for proper survey
software like Ekahau or iBwave. Real-world RF behaviour depends on
materials, ceiling heights, and interference that this model doesn't
capture.

## Tech Stack

- Backend: Python 3.12, FastAPI, SQLModel, OpenCV (headless), pypdf, Anthropic SDK
- Frontend: React 18, Vite, React Router
- Database: SQLite
- Deployment: Docker Compose

## License

MIT
