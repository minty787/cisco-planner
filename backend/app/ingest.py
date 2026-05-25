"""Datasheet ingestion.

Two paths:
  1. Local text extraction (pypdf) + regex-based heuristics for common spec fields.
     Free, works offline, but brittle on complex layouts.
  2. Optional Anthropic API extraction. If ANTHROPIC_API_KEY is set, we send
     the extracted text to Claude with a strict JSON schema prompt for
     much more reliable parsing.

Either path returns a dict of fields that map onto the Device model.
"""
from __future__ import annotations

import json
import os
import re
from typing import Any, Dict, Optional

from pypdf import PdfReader

try:
    from anthropic import Anthropic
    _ANTHROPIC_AVAILABLE = True
except ImportError:
    _ANTHROPIC_AVAILABLE = False


SCHEMA_PROMPT = """You are extracting structured specifications from a Cisco or
Cisco Meraki datasheet. Return ONLY a JSON object with these fields (use null
when a value is not stated):

{
  "sku": "string (the orderable part number, e.g. C9300-24P or MR46)",
  "vendor": "Cisco" or "Meraki",
  "family": "switch" | "access_point" | "firewall" | "router" | "camera" | "sensor",
  "model_name": "string",
  "description": "one-sentence summary",
  "rack_units": number (0 if not rack-mounted),
  "weight_kg": number,
  "power_watts": number (max power draw),
  "ports_1g": int,
  "ports_2_5g": int,
  "ports_10g": int,
  "ports_25g": int,
  "ports_40g": int,
  "ports_100g": int,
  "poe_watts": number (total PoE budget),
  "wifi_standard": "" | "wifi5" | "wifi6" | "wifi6e" | "wifi7",
  "radios": int,
  "max_clients": int,
  "coverage_radius_m": number (estimate from spec or leave 0),
  "license_required": boolean
}

Return ONLY the JSON object, no markdown fences, no commentary."""


def extract_pdf_text(path: str, max_chars: int = 30000) -> str:
    """Extract text from a PDF, truncated to keep API costs bounded."""
    reader = PdfReader(path)
    text_parts = []
    total = 0
    for page in reader.pages:
        chunk = page.extract_text() or ""
        text_parts.append(chunk)
        total += len(chunk)
        if total > max_chars:
            break
    return "\n".join(text_parts)[:max_chars]


def heuristic_parse(text: str) -> Dict[str, Any]:
    """Very rough regex-based fallback when no API key is set."""
    out: Dict[str, Any] = {
        "sku": "",
        "vendor": "Cisco",
        "family": "switch",
        "model_name": "",
        "description": "",
        "rack_units": 0.0,
        "weight_kg": 0.0,
        "power_watts": 0.0,
        "ports_1g": 0,
        "ports_2_5g": 0,
        "ports_10g": 0,
        "ports_25g": 0,
        "ports_40g": 0,
        "ports_100g": 0,
        "poe_watts": 0.0,
        "wifi_standard": "",
        "radios": 0,
        "max_clients": 0,
        "coverage_radius_m": 0.0,
        "license_required": False,
    }

    if re.search(r"\bmeraki\b", text, re.I):
        out["vendor"] = "Meraki"

    # SKU patterns: C9300-24P, MR46, MS220, MX85, MV12, MT10
    sku_match = re.search(
        r"\b(C\d{4}-\d{2}[A-Z]+|M[RSXVT]\d{2,3}[A-Z]?)\b",
        text,
    )
    if sku_match:
        out["sku"] = sku_match.group(1)
        out["model_name"] = sku_match.group(1)

    # Family guesses
    lowered = text.lower()
    if "access point" in lowered or "wireless ap" in lowered or re.search(r"\bMR\d", text):
        out["family"] = "access_point"
    elif "firewall" in lowered or re.search(r"\bMX\d", text):
        out["family"] = "firewall"
    elif "router" in lowered:
        out["family"] = "router"
    elif "camera" in lowered or re.search(r"\bMV\d", text):
        out["family"] = "camera"
    elif "sensor" in lowered or re.search(r"\bMT\d", text):
        out["family"] = "sensor"

    # WiFi standards
    if re.search(r"wi-?fi\s*7|802\.11be", text, re.I):
        out["wifi_standard"] = "wifi7"
    elif re.search(r"wi-?fi\s*6e", text, re.I):
        out["wifi_standard"] = "wifi6e"
    elif re.search(r"wi-?fi\s*6|802\.11ax", text, re.I):
        out["wifi_standard"] = "wifi6"
    elif re.search(r"802\.11ac", text, re.I):
        out["wifi_standard"] = "wifi5"

    # Rack units
    ru_match = re.search(r"(\d+(?:\.\d+)?)\s*(?:RU|U\b)", text)
    if ru_match:
        out["rack_units"] = float(ru_match.group(1))

    # PoE budget
    poe_match = re.search(r"PoE[^.]{0,40}?(\d+)\s*W", text, re.I)
    if poe_match:
        out["poe_watts"] = float(poe_match.group(1))

    # Port counts (rough)
    port_24 = re.search(r"(\d+)\s*[x\u00d7]\s*(?:1\s*G|GbE|gigabit)", text, re.I)
    if port_24:
        out["ports_1g"] = int(port_24.group(1))

    return out


def ai_parse(text: str) -> Optional[Dict[str, Any]]:
    """Use Anthropic API for accurate extraction. Returns None if unavailable."""
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not (api_key and _ANTHROPIC_AVAILABLE):
        return None
    client = Anthropic(api_key=api_key)
    msg = client.messages.create(
        model="claude-sonnet-4-5",
        max_tokens=1500,
        system=SCHEMA_PROMPT,
        messages=[{"role": "user", "content": text}],
    )
    raw = "".join(block.text for block in msg.content if hasattr(block, "text"))
    # Strip possible fences just in case
    raw = re.sub(r"^```(?:json)?|```$", "", raw.strip(), flags=re.MULTILINE).strip()
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return None


def ingest_pdf(path: str, prefer_ai: bool = True) -> Dict[str, Any]:
    """Parse a datasheet PDF and return a dict suitable for Device creation."""
    text = extract_pdf_text(path)
    if prefer_ai:
        parsed = ai_parse(text)
        if parsed:
            parsed["_method"] = "ai"
            return parsed
    parsed = heuristic_parse(text)
    parsed["_method"] = "heuristic"
    return parsed
