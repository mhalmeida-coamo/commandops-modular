"""Parses Cypress XML files: devices.xml (printers) and roles.xml (groups)."""
from __future__ import annotations
import xml.etree.ElementTree as ET
from fastapi import HTTPException


def _decode_xml_bytes(raw: bytes) -> str:
    if raw.startswith(b'\xff\xfe') or raw.startswith(b'\xfe\xff'):
        content = raw.decode('utf-16')
    else:
        try:
            content = raw.decode('utf-8')
        except UnicodeDecodeError:
            content = raw.decode('utf-16')
    if content.startswith('﻿'):
        content = content[1:]
    return content


def parse_printers(xml_bytes: bytes, query: str) -> list[dict]:
    """Parse devices.xml and filter by query against obj_name."""
    content = _decode_xml_bytes(xml_bytes)
    try:
        root = ET.fromstring(content)
    except ET.ParseError as exc:
        raise HTTPException(status_code=502, detail=f"XML de devices inválido: {exc}") from exc

    results: list[dict] = []
    query_lower = query.strip().lower()

    for device in root.findall(".//device"):
        obj_name = device.get("obj_name", "")
        if query_lower and query_lower not in obj_name.lower():
            continue

        info: dict = {
            "name": obj_name,
            "style": "",
            "description": "",
            "host": "",
            "port": "",
            "direct_users": [],
            "roles": [],
        }

        general = device.find("general")
        if general is not None:
            for tag, key in [("style", "style"), ("description", "description"), ("host", "host"), ("unit", "port")]:
                el = general.find(tag)
                info[key] = el.text if el is not None and el.text else ""

        security = device.find("security")
        if security is not None:
            for user in security.findall("user"):
                info["direct_users"].append({
                    "domain": user.get("domain_name", ""),
                    "account": user.get("account_name", ""),
                    "permission": user.get("permission", ""),
                })
            for role in security.findall("role"):
                info["roles"].append({
                    "name": role.get("obj_name", ""),
                    "docuvault": role.get("docuvault", ""),
                    "permission": role.get("permission", ""),
                    "description": "",
                    "role_type": "",
                    "members": [],
                    "admins": [],
                })

        results.append(info)

    return results


def parse_roles(xml_bytes: bytes, role_names: list[str]) -> dict[str, dict]:
    """Parse roles.xml and return dict keyed by role obj_name."""
    content = _decode_xml_bytes(xml_bytes)
    try:
        root = ET.fromstring(content)
    except ET.ParseError as exc:
        raise HTTPException(status_code=502, detail=f"XML de roles inválido: {exc}") from exc

    role_names_lower = {r.lower() for r in role_names}
    roles: dict[str, dict] = {}

    for role in root.findall(".//role"):
        obj_name = role.get("obj_name", "")
        if obj_name.lower() not in role_names_lower:
            continue

        info: dict = {
            "name": obj_name,
            "description": "",
            "role_type": "",
            "members": [],
            "admins": [],
        }

        desc = role.find("description")
        rt = role.find("role_type")
        info["description"] = desc.text if desc is not None and desc.text else ""
        info["role_type"] = rt.text if rt is not None and rt.text else ""

        members_el = role.find("members")
        if members_el is not None:
            for user in members_el.findall("user"):
                info["members"].append({
                    "domain": user.get("domain_name", ""),
                    "account": user.get("account_name", ""),
                    "permission": user.get("permission", ""),
                })

        security = role.find("security")
        if security is not None:
            for user in security.findall("user"):
                info["admins"].append({
                    "domain": user.get("domain_name", ""),
                    "account": user.get("account_name", ""),
                    "permission": user.get("permission", ""),
                })

        roles[obj_name] = info

    return roles
