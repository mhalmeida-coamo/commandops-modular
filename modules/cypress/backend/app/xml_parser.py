"""Parses Cypress XML files: devices.xml (printers) and roles.xml (groups)."""
from __future__ import annotations
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field


@dataclass
class Printer:
    id: str
    name: str
    queue: str
    location: str = ""
    description: str = ""


@dataclass
class RoleMember:
    dn: str
    display_name: str = ""


@dataclass
class Role:
    id: str
    name: str
    group_dn: str
    members: list[RoleMember] = field(default_factory=list)


def parse_printers(xml_bytes: bytes) -> list[Printer]:
    """Parse devices.xml — returns list of Printer objects."""
    root = ET.fromstring(xml_bytes)
    printers: list[Printer] = []

    for device in root.iter("Device"):
        pid = device.get("id") or device.findtext("Id") or ""
        name = device.findtext("Name") or device.get("name") or ""
        queue = device.findtext("Queue") or device.findtext("PrintQueue") or device.get("queue") or ""
        location = device.findtext("Location") or device.get("location") or ""
        description = device.findtext("Description") or device.get("description") or ""
        if pid or name:
            printers.append(Printer(
                id=pid,
                name=name,
                queue=queue,
                location=location,
                description=description,
            ))

    return printers


def parse_roles(xml_bytes: bytes) -> list[Role]:
    """Parse roles.xml — returns list of Role objects with members."""
    root = ET.fromstring(xml_bytes)
    roles: list[Role] = []

    for role_el in root.iter("Role"):
        rid = role_el.get("id") or role_el.findtext("Id") or ""
        name = role_el.findtext("Name") or role_el.get("name") or ""
        group_dn = role_el.findtext("GroupDN") or role_el.get("groupDN") or role_el.get("group_dn") or ""

        members: list[RoleMember] = []
        members_el = role_el.find("Members")
        if members_el is not None:
            for m in members_el.iter("Member"):
                dn = m.findtext("DN") or m.get("dn") or ""
                display = m.findtext("DisplayName") or m.get("displayName") or ""
                if dn:
                    members.append(RoleMember(dn=dn, display_name=display))

        roles.append(Role(id=rid, name=name, group_dn=group_dn, members=members))

    return roles


def search_printers(printers: list[Printer], query: str) -> list[Printer]:
    q = query.strip().lower()
    if not q:
        return printers
    return [
        p for p in printers
        if q in p.name.lower() or q in p.queue.lower() or q in p.location.lower()
    ]
