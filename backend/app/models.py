"""SQLModel database models for the Cisco/Meraki Network Planner."""
from datetime import datetime
from typing import Optional
from sqlmodel import SQLModel, Field, Column, JSON


class Device(SQLModel, table=True):
    """A Cisco or Meraki device that can be placed in a plan."""
    model_config = {"protected_namespaces": ()}

    id: Optional[int] = Field(default=None, primary_key=True)
    sku: str = Field(index=True, unique=True)
    vendor: str = Field(default="Cisco")  # Cisco | Meraki
    family: str  # switch | access_point | firewall | router | camera | sensor
    model_name: str
    description: str = ""
    # Physical attributes for rack planning
    rack_units: float = 0.0  # 1.0 = 1U, 0 = not rack-mounted
    weight_kg: float = 0.0
    power_watts: float = 0.0
    # Port counts (switches/routers)
    ports_1g: int = 0
    ports_2_5g: int = 0
    ports_10g: int = 0
    ports_25g: int = 0
    ports_40g: int = 0
    ports_100g: int = 0
    poe_watts: float = 0.0  # total PoE budget
    # Wireless attributes (APs)
    wifi_standard: str = ""  # wifi5 | wifi6 | wifi6e | wifi7
    radios: int = 0
    max_clients: int = 0
    coverage_radius_m: float = 0.0  # nominal indoor radius
    # Pricing/licensing
    license_required: bool = False
    list_price_usd: float = 0.0
    # Free-form spec sheet from PDF ingest
    raw_specs: Optional[dict] = Field(default=None, sa_column=Column(JSON))
    datasheet_filename: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)


class Project(SQLModel, table=True):
    """A network design project."""
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    customer: str = ""
    notes: str = ""
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class FloorPlan(SQLModel, table=True):
    """An uploaded floor plan image belonging to a project."""
    id: Optional[int] = Field(default=None, primary_key=True)
    project_id: int = Field(foreign_key="project.id", index=True)
    name: str
    image_filename: str
    width_px: int = 0
    height_px: int = 0
    scale_m_per_px: float = 0.05  # default: 5 cm per pixel
    # Detected/edited features: {walls: [...], doors: [...], windows: [...]}
    features: Optional[dict] = Field(default=None, sa_column=Column(JSON))
    # AP placements: [{device_id, x, y, label}]
    ap_placements: Optional[list] = Field(default=None, sa_column=Column(JSON))
    created_at: datetime = Field(default_factory=datetime.utcnow)


class Rack(SQLModel, table=True):
    """A rack within a project."""
    id: Optional[int] = Field(default=None, primary_key=True)
    project_id: int = Field(foreign_key="project.id", index=True)
    name: str
    height_u: int = 42
    location: str = ""
    # Slots: [{u_position, device_id, label, orientation}]
    slots: Optional[list] = Field(default=None, sa_column=Column(JSON))
    created_at: datetime = Field(default_factory=datetime.utcnow)


class BillOfMaterials(SQLModel, table=True):
    """Computed BOM snapshot for a project (regenerated on demand)."""
    id: Optional[int] = Field(default=None, primary_key=True)
    project_id: int = Field(foreign_key="project.id", index=True)
    line_items: Optional[list] = Field(default=None, sa_column=Column(JSON))
    total_usd: float = 0.0
    generated_at: datetime = Field(default_factory=datetime.utcnow)
