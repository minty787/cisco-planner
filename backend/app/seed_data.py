"""Seed data — representative Cisco Catalyst and Meraki SKUs.

Specs are derived from public Cisco/Meraki product pages. Prices are nominal
list-price placeholders for planning; replace with your distributor pricing.
"""
from sqlmodel import Session, select

from .db import engine
from .models import Device


SEED = [
    # ------------------------------- Meraki MS switches
    dict(sku="MS120-8", vendor="Meraki", family="switch", model_name="MS120-8",
         description="8-port Gigabit access switch (non-PoE)",
         rack_units=0, weight_kg=0.8, power_watts=20,
         ports_1g=8, license_required=True, list_price_usd=395),
    dict(sku="MS120-24P", vendor="Meraki", family="switch", model_name="MS120-24P",
         description="24-port Gigabit access switch with PoE+",
         rack_units=1, weight_kg=3.0, power_watts=410,
         ports_1g=24, poe_watts=370, license_required=True, list_price_usd=1995),
    dict(sku="MS125-48LP", vendor="Meraki", family="switch", model_name="MS125-48LP",
         description="48-port Gigabit access switch with PoE+ and 10G uplinks",
         rack_units=1, weight_kg=4.5, power_watts=420,
         ports_1g=48, ports_10g=4, poe_watts=370, license_required=True, list_price_usd=3795),
    dict(sku="MS390-24P", vendor="Meraki", family="switch", model_name="MS390-24P",
         description="24-port stackable access switch, PoE+, multigigabit",
         rack_units=1, weight_kg=6.0, power_watts=715,
         ports_1g=24, ports_10g=4, poe_watts=480, license_required=True, list_price_usd=5995),

    # ------------------------------- Cisco Catalyst switches
    dict(sku="C9200-24T-A", vendor="Cisco", family="switch", model_name="Catalyst 9200 24T",
         description="24-port Gigabit Catalyst 9200, data-only",
         rack_units=1, weight_kg=4.1, power_watts=110,
         ports_1g=24, ports_10g=4, license_required=True, list_price_usd=2895),
    dict(sku="C9300-48P-A", vendor="Cisco", family="switch", model_name="Catalyst 9300 48P",
         description="48-port Gigabit Catalyst 9300, UPoE",
         rack_units=1, weight_kg=7.8, power_watts=1100,
         ports_1g=48, ports_10g=8, poe_watts=822, license_required=True, list_price_usd=8995),
    dict(sku="C9300X-24Y-A", vendor="Cisco", family="switch", model_name="Catalyst 9300X 24Y",
         description="24-port 25G SFP28 Catalyst 9300X",
         rack_units=1, weight_kg=8.0, power_watts=715,
         ports_25g=24, ports_40g=4, license_required=True, list_price_usd=15995),

    # ------------------------------- Meraki MR access points
    dict(sku="MR36", vendor="Meraki", family="access_point", model_name="MR36",
         description="Wi-Fi 6 dual-radio cloud-managed AP",
         rack_units=0, weight_kg=0.65, power_watts=15,
         wifi_standard="wifi6", radios=2, max_clients=200, coverage_radius_m=18,
         license_required=True, list_price_usd=895),
    dict(sku="MR46", vendor="Meraki", family="access_point", model_name="MR46",
         description="Wi-Fi 6 4x4:4 high-performance AP",
         rack_units=0, weight_kg=0.85, power_watts=25,
         wifi_standard="wifi6", radios=2, max_clients=350, coverage_radius_m=22,
         license_required=True, list_price_usd=1495),
    dict(sku="MR57", vendor="Meraki", family="access_point", model_name="MR57",
         description="Wi-Fi 6E tri-radio enterprise AP",
         rack_units=0, weight_kg=1.0, power_watts=30,
         wifi_standard="wifi6e", radios=3, max_clients=500, coverage_radius_m=20,
         license_required=True, list_price_usd=2395),
    dict(sku="CW9166I", vendor="Cisco", family="access_point", model_name="Catalyst 9166I",
         description="Wi-Fi 6E tri-radio Catalyst access point",
         rack_units=0, weight_kg=1.05, power_watts=30,
         wifi_standard="wifi6e", radios=3, max_clients=500, coverage_radius_m=22,
         license_required=True, list_price_usd=2195),
    dict(sku="CW9176I", vendor="Cisco", family="access_point", model_name="Catalyst 9176I",
         description="Wi-Fi 7 tri-radio Catalyst access point",
         rack_units=0, weight_kg=1.2, power_watts=35,
         wifi_standard="wifi7", radios=3, max_clients=600, coverage_radius_m=24,
         license_required=True, list_price_usd=2895),

    # ------------------------------- Meraki MX firewalls
    dict(sku="MX67", vendor="Meraki", family="firewall", model_name="MX67",
         description="Branch security appliance, 450 Mbps stateful FW",
         rack_units=0, weight_kg=0.7, power_watts=15,
         ports_1g=5, license_required=True, list_price_usd=695),
    dict(sku="MX85", vendor="Meraki", family="firewall", model_name="MX85",
         description="Medium branch security appliance, 1 Gbps stateful FW",
         rack_units=1, weight_kg=4.0, power_watts=60,
         ports_1g=10, ports_10g=2, license_required=True, list_price_usd=4995),
    dict(sku="MX95", vendor="Meraki", family="firewall", model_name="MX95",
         description="Campus security appliance, 5 Gbps stateful FW",
         rack_units=1, weight_kg=4.5, power_watts=85,
         ports_1g=8, ports_10g=4, license_required=True, list_price_usd=8995),

    # ------------------------------- Cisco routers
    dict(sku="ISR4331/K9", vendor="Cisco", family="router", model_name="ISR 4331",
         description="Integrated Services Router for branch",
         rack_units=1, weight_kg=4.5, power_watts=75,
         ports_1g=3, license_required=True, list_price_usd=3495),
    dict(sku="C8300-1N1S-4T2X", vendor="Cisco", family="router", model_name="Catalyst 8300",
         description="SD-WAN edge platform for branch and small campus",
         rack_units=1, weight_kg=6.8, power_watts=130,
         ports_1g=4, ports_10g=2, license_required=True, list_price_usd=8995),

    # ------------------------------- Meraki MV cameras / MT sensors
    dict(sku="MV12N", vendor="Meraki", family="camera", model_name="MV12N",
         description="Compact indoor cloud-managed camera (256GB)",
         rack_units=0, weight_kg=0.4, power_watts=8,
         license_required=True, list_price_usd=999),
    dict(sku="MV32", vendor="Meraki", family="camera", model_name="MV32",
         description="180° fisheye indoor cloud camera",
         rack_units=0, weight_kg=0.6, power_watts=10,
         license_required=True, list_price_usd=1499),
    dict(sku="MT10", vendor="Meraki", family="sensor", model_name="MT10",
         description="Wireless temperature & humidity sensor",
         rack_units=0, weight_kg=0.1, power_watts=0,
         license_required=True, list_price_usd=149),
]


def seed_devices() -> None:
    """Insert seed devices if the table is empty."""
    with Session(engine) as session:
        existing = session.exec(select(Device)).first()
        if existing:
            return
        for row in SEED:
            session.add(Device(**row))
        session.commit()
