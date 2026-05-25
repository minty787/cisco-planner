"""FastAPI application — Cisco/Meraki Network Planner backend."""
from __future__ import annotations

import os
import uuid
from typing import List, Optional

from fastapi import FastAPI, Depends, HTTPException, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from sqlmodel import Session, select

from . import floorplan as fp
from . import ingest
from . import wifi
from .db import init_db, get_session, DATA_DIR
from .models import Device, Project, FloorPlan, Rack, BillOfMaterials
from .seed_data import seed_devices

UPLOAD_DIR = os.environ.get("UPLOAD_DIR", "/app/uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

app = FastAPI(title="Cisco/Meraki Network Planner", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def _startup() -> None:
    init_db()
    seed_devices()


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# DEVICES
# ---------------------------------------------------------------------------

@app.get("/api/devices", response_model=List[Device])
def list_devices(
    family: Optional[str] = None,
    vendor: Optional[str] = None,
    session: Session = Depends(get_session),
):
    stmt = select(Device)
    if family:
        stmt = stmt.where(Device.family == family)
    if vendor:
        stmt = stmt.where(Device.vendor == vendor)
    return session.exec(stmt.order_by(Device.vendor, Device.family, Device.sku)).all()


@app.get("/api/devices/{device_id}", response_model=Device)
def get_device(device_id: int, session: Session = Depends(get_session)):
    device = session.get(Device, device_id)
    if not device:
        raise HTTPException(404, "Device not found")
    return device


@app.post("/api/devices", response_model=Device)
def create_device(device: Device, session: Session = Depends(get_session)):
    # Upsert by SKU
    existing = session.exec(select(Device).where(Device.sku == device.sku)).first()
    if existing:
        for k, v in device.model_dump(exclude={"id", "created_at"}).items():
            setattr(existing, k, v)
        session.add(existing)
        session.commit()
        session.refresh(existing)
        return existing
    session.add(device)
    session.commit()
    session.refresh(device)
    return device


@app.delete("/api/devices/{device_id}")
def delete_device(device_id: int, session: Session = Depends(get_session)):
    device = session.get(Device, device_id)
    if not device:
        raise HTTPException(404, "Device not found")
    session.delete(device)
    session.commit()
    return {"deleted": device_id}


@app.post("/api/devices/ingest-pdf")
async def ingest_datasheet(
    file: UploadFile = File(...),
    prefer_ai: bool = Form(True),
    save: bool = Form(False),
    session: Session = Depends(get_session),
):
    """Upload a datasheet PDF and parse out device specs."""
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(400, "Expected a .pdf file")
    fname = f"datasheet_{uuid.uuid4().hex}.pdf"
    path = os.path.join(UPLOAD_DIR, fname)
    with open(path, "wb") as f:
        f.write(await file.read())
    parsed = ingest.ingest_pdf(path, prefer_ai=prefer_ai)
    if save and parsed.get("sku"):
        d = Device(
            **{k: v for k, v in parsed.items() if k in Device.model_fields and v is not None},
            datasheet_filename=fname,
            raw_specs=parsed,
        )
        # Re-use create_device upsert logic
        existing = session.exec(select(Device).where(Device.sku == d.sku)).first()
        if existing:
            for k, v in d.model_dump(exclude={"id", "created_at"}).items():
                if v not in (None, "", 0, 0.0):
                    setattr(existing, k, v)
            session.add(existing)
            session.commit()
            session.refresh(existing)
            parsed["_device_id"] = existing.id
        else:
            session.add(d)
            session.commit()
            session.refresh(d)
            parsed["_device_id"] = d.id
    return parsed


# ---------------------------------------------------------------------------
# PROJECTS
# ---------------------------------------------------------------------------

@app.get("/api/projects", response_model=List[Project])
def list_projects(session: Session = Depends(get_session)):
    return session.exec(select(Project).order_by(Project.updated_at.desc())).all()


@app.post("/api/projects", response_model=Project)
def create_project(project: Project, session: Session = Depends(get_session)):
    session.add(project)
    session.commit()
    session.refresh(project)
    return project


@app.get("/api/projects/{project_id}", response_model=Project)
def get_project(project_id: int, session: Session = Depends(get_session)):
    proj = session.get(Project, project_id)
    if not proj:
        raise HTTPException(404, "Project not found")
    return proj


@app.put("/api/projects/{project_id}", response_model=Project)
def update_project(project_id: int, patch: dict, session: Session = Depends(get_session)):
    proj = session.get(Project, project_id)
    if not proj:
        raise HTTPException(404, "Project not found")
    for k, v in patch.items():
        if hasattr(proj, k):
            setattr(proj, k, v)
    session.add(proj)
    session.commit()
    session.refresh(proj)
    return proj


@app.delete("/api/projects/{project_id}")
def delete_project(project_id: int, session: Session = Depends(get_session)):
    proj = session.get(Project, project_id)
    if not proj:
        raise HTTPException(404, "Project not found")
    # Cascade
    for fpl in session.exec(select(FloorPlan).where(FloorPlan.project_id == project_id)).all():
        session.delete(fpl)
    for rk in session.exec(select(Rack).where(Rack.project_id == project_id)).all():
        session.delete(rk)
    session.delete(proj)
    session.commit()
    return {"deleted": project_id}


# ---------------------------------------------------------------------------
# FLOOR PLANS
# ---------------------------------------------------------------------------

@app.get("/api/projects/{project_id}/floorplans", response_model=List[FloorPlan])
def list_floorplans(project_id: int, session: Session = Depends(get_session)):
    return session.exec(
        select(FloorPlan).where(FloorPlan.project_id == project_id)
    ).all()


@app.post("/api/projects/{project_id}/floorplans", response_model=FloorPlan)
async def upload_floorplan(
    project_id: int,
    name: str = Form(...),
    auto_detect: bool = Form(True),
    file: UploadFile = File(...),
    session: Session = Depends(get_session),
):
    if not session.get(Project, project_id):
        raise HTTPException(404, "Project not found")
    ext = os.path.splitext(file.filename or "plan.png")[1] or ".png"
    fname = f"plan_{uuid.uuid4().hex}{ext}"
    path = os.path.join(UPLOAD_DIR, fname)
    with open(path, "wb") as f:
        f.write(await file.read())
    features = {"walls": [], "doors": [], "windows": []}
    w_px, h_px = 0, 0
    if auto_detect:
        try:
            features = fp.analyze(path)
            w_px = features.pop("width_px")
            h_px = features.pop("height_px")
        except Exception as e:  # noqa: BLE001
            features = {"walls": [], "doors": [], "windows": [], "error": str(e)}
    floor = FloorPlan(
        project_id=project_id,
        name=name,
        image_filename=fname,
        width_px=w_px,
        height_px=h_px,
        features=features,
        ap_placements=[],
    )
    session.add(floor)
    session.commit()
    session.refresh(floor)
    return floor


@app.get("/api/floorplans/{plan_id}", response_model=FloorPlan)
def get_floorplan(plan_id: int, session: Session = Depends(get_session)):
    floor = session.get(FloorPlan, plan_id)
    if not floor:
        raise HTTPException(404, "Floor plan not found")
    return floor


@app.put("/api/floorplans/{plan_id}", response_model=FloorPlan)
def update_floorplan(plan_id: int, patch: dict, session: Session = Depends(get_session)):
    floor = session.get(FloorPlan, plan_id)
    if not floor:
        raise HTTPException(404, "Floor plan not found")
    for k, v in patch.items():
        if hasattr(floor, k):
            setattr(floor, k, v)
    session.add(floor)
    session.commit()
    session.refresh(floor)
    return floor


@app.delete("/api/floorplans/{plan_id}")
def delete_floorplan(plan_id: int, session: Session = Depends(get_session)):
    floor = session.get(FloorPlan, plan_id)
    if not floor:
        raise HTTPException(404, "Floor plan not found")
    session.delete(floor)
    session.commit()
    return {"deleted": plan_id}


@app.get("/api/floorplans/{plan_id}/image")
def get_floorplan_image(plan_id: int, session: Session = Depends(get_session)):
    floor = session.get(FloorPlan, plan_id)
    if not floor:
        raise HTTPException(404, "Floor plan not found")
    path = os.path.join(UPLOAD_DIR, floor.image_filename)
    if not os.path.exists(path):
        raise HTTPException(404, "Image file missing")
    return FileResponse(path)


@app.post("/api/floorplans/{plan_id}/heatmap")
def compute_floorplan_heatmap(plan_id: int, session: Session = Depends(get_session)):
    """Compute the WiFi RSSI heatmap for the current AP placements."""
    floor = session.get(FloorPlan, plan_id)
    if not floor:
        raise HTTPException(404, "Floor plan not found")
    features = floor.features or {}
    walls = features.get("walls", [])
    windows = features.get("windows", [])
    doors = features.get("doors", [])
    columns = features.get("columns", [])
    aps_raw = floor.ap_placements or []
    aps = []
    for ap in aps_raw:
        device = session.get(Device, ap.get("device_id"))
        # Use 18 dBm default if device has no explicit TX value
        aps.append({
            "x": ap["x"],
            "y": ap["y"],
            "tx_dbm": ap.get("tx_dbm", 18.0),
            "device": device.sku if device else "AP",
        })
    return wifi.compute_heatmap(
        width_px=floor.width_px,
        height_px=floor.height_px,
        scale_m_per_px=floor.scale_m_per_px,
        aps=aps,
        walls=walls,
        windows=windows,
        doors=doors,
        columns=columns,
    )


# ---------------------------------------------------------------------------
# RACKS
# ---------------------------------------------------------------------------

@app.get("/api/projects/{project_id}/racks", response_model=List[Rack])
def list_racks(project_id: int, session: Session = Depends(get_session)):
    return session.exec(select(Rack).where(Rack.project_id == project_id)).all()


@app.post("/api/projects/{project_id}/racks", response_model=Rack)
def create_rack(project_id: int, rack: Rack, session: Session = Depends(get_session)):
    if not session.get(Project, project_id):
        raise HTTPException(404, "Project not found")
    rack.project_id = project_id
    if rack.slots is None:
        rack.slots = []
    session.add(rack)
    session.commit()
    session.refresh(rack)
    return rack


@app.put("/api/racks/{rack_id}", response_model=Rack)
def update_rack(rack_id: int, patch: dict, session: Session = Depends(get_session)):
    rack = session.get(Rack, rack_id)
    if not rack:
        raise HTTPException(404, "Rack not found")
    for k, v in patch.items():
        if hasattr(rack, k):
            setattr(rack, k, v)
    session.add(rack)
    session.commit()
    session.refresh(rack)
    return rack


@app.delete("/api/racks/{rack_id}")
def delete_rack(rack_id: int, session: Session = Depends(get_session)):
    rack = session.get(Rack, rack_id)
    if not rack:
        raise HTTPException(404, "Rack not found")
    session.delete(rack)
    session.commit()
    return {"deleted": rack_id}


# ---------------------------------------------------------------------------
# BILL OF MATERIALS
# ---------------------------------------------------------------------------

@app.get("/api/projects/{project_id}/bom")
def compute_bom(project_id: int, session: Session = Depends(get_session)):
    """Generate a fresh BOM from the project's racks + AP placements."""
    if not session.get(Project, project_id):
        raise HTTPException(404, "Project not found")
    counts: dict[int, int] = {}
    # Racks
    for rack in session.exec(select(Rack).where(Rack.project_id == project_id)).all():
        for slot in (rack.slots or []):
            did = slot.get("device_id")
            if did:
                counts[did] = counts.get(did, 0) + 1
    # APs on floor plans
    for floor in session.exec(select(FloorPlan).where(FloorPlan.project_id == project_id)).all():
        for ap in (floor.ap_placements or []):
            did = ap.get("device_id")
            if did:
                counts[did] = counts.get(did, 0) + 1
    line_items = []
    total = 0.0
    total_power = 0.0
    total_ru = 0.0
    for device_id, qty in counts.items():
        device = session.get(Device, device_id)
        if not device:
            continue
        subtotal = device.list_price_usd * qty
        total += subtotal
        total_power += device.power_watts * qty
        total_ru += device.rack_units * qty
        line_items.append({
            "device_id": device_id,
            "sku": device.sku,
            "vendor": device.vendor,
            "family": device.family,
            "model_name": device.model_name,
            "quantity": qty,
            "unit_price_usd": device.list_price_usd,
            "subtotal_usd": round(subtotal, 2),
            "rack_units_each": device.rack_units,
            "power_watts_each": device.power_watts,
        })
    line_items.sort(key=lambda x: (x["vendor"], x["family"], x["sku"]))
    return {
        "project_id": project_id,
        "line_items": line_items,
        "total_usd": round(total, 2),
        "total_power_watts": round(total_power, 1),
        "total_rack_units": round(total_ru, 1),
        "device_count": sum(counts.values()),
    }
