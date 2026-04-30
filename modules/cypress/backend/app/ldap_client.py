"""LDAP operations via ldap3: group member lookup and add-user."""
from __future__ import annotations
import ldap3
from ldap3.core.exceptions import LDAPException
from ldap3.utils.conv import escape_filter_chars
from ldap3 import MODIFY_ADD
from fastapi import HTTPException


def _connect(server: str, user_dn: str, password: str) -> ldap3.Connection:
    srv = ldap3.Server(server, get_info=ldap3.ALL)
    conn = ldap3.Connection(srv, user=user_dn, password=password, auto_bind=True)
    if not conn.bound:
        raise HTTPException(status_code=502, detail=f"LDAP bind falhou para {user_dn}")
    return conn


def get_group_members(
    server: str,
    base_dn: str,
    bind_user: str,
    bind_password: str,
    group_name: str,
) -> dict:
    """Find group by name and return recursive members via memberOf:1.2.840..."""
    try:
        conn = _connect(server, bind_user, bind_password)
    except LDAPException as exc:
        raise HTTPException(status_code=502, detail=f"LDAP connection failed: {exc}") from exc

    try:
        safe_group = escape_filter_chars(group_name)
        conn.search(
            search_base=base_dn,
            search_filter=f"(&(objectClass=group)(|(cn={safe_group})(sAMAccountName={safe_group})))",
            attributes=["distinguishedName", "cn", "description"],
        )
        if not conn.entries:
            return {"group": group_name, "found": False, "count": 0, "members": []}

        entry = conn.entries[0]
        attrs = entry.entry_attributes_as_dict
        group_dn = attrs.get("distinguishedName", [""])[0]
        group_cn = attrs.get("cn", [""])[0]
        group_desc = attrs.get("description", [""])[0] if attrs.get("description") else ""

        safe_dn = escape_filter_chars(group_dn)
        conn.search(
            search_base=base_dn,
            search_filter=f"(memberOf:1.2.840.113556.1.4.1941:={safe_dn})",
            attributes=["displayName", "cn", "sAMAccountName", "mail", "department", "title", "distinguishedName", "objectClass", "employeeID"],
            size_limit=500,
        )

        members = []
        for m in conn.entries:
            ma = m.entry_attributes_as_dict
            ocs = [oc.lower() for oc in ma.get("objectClass", [])]
            members.append({
                "displayName": ma.get("displayName", [""])[0] if ma.get("displayName") else "",
                "cn": ma.get("cn", [""])[0] if ma.get("cn") else "",
                "sAMAccountName": ma.get("sAMAccountName", [""])[0] if ma.get("sAMAccountName") else "",
                "mail": ma.get("mail", [""])[0] if ma.get("mail") else "",
                "department": ma.get("department", [""])[0] if ma.get("department") else "",
                "title": ma.get("title", [""])[0] if ma.get("title") else "",
                "employeeID": ma.get("employeeID", [""])[0] if ma.get("employeeID") else "",
                "type": "group" if "group" in ocs else "user",
                "dn": ma.get("distinguishedName", [""])[0] if ma.get("distinguishedName") else "",
            })

        return {
            "group": group_name,
            "group_cn": group_cn,
            "group_description": group_desc,
            "found": True,
            "count": len(members),
            "members": members,
        }
    except LDAPException as exc:
        raise HTTPException(status_code=502, detail=f"LDAP error: {exc}") from exc
    finally:
        conn.unbind()


def add_user_to_group(
    server: str,
    base_dn: str,
    bind_user: str,
    bind_password: str,
    group_name: str,
    username: str,
) -> dict:
    """Find group and user by name, then MODIFY_ADD user to group."""
    try:
        conn = _connect(server, bind_user, bind_password)
    except LDAPException as exc:
        raise HTTPException(status_code=502, detail=f"LDAP connection failed: {exc}") from exc

    try:
        # Resolve group DN
        safe_group = escape_filter_chars(group_name)
        conn.search(
            search_base=base_dn,
            search_filter=f"(&(objectClass=group)(|(cn={safe_group})(sAMAccountName={safe_group})))",
            attributes=["distinguishedName", "cn"],
        )
        if not conn.entries:
            raise HTTPException(status_code=404, detail=f"Grupo '{group_name}' não encontrado")
        ga = conn.entries[0].entry_attributes_as_dict
        group_dn = ga.get("distinguishedName", [""])[0]
        group_cn = ga.get("cn", [""])[0] or group_name

        # Resolve user DN — strip domain/UPN prefix for short name lookup
        user_short = username
        if "\\" in user_short:
            user_short = user_short.split("\\")[-1]
        if "@" in user_short:
            user_short = user_short.split("@")[0]

        candidates = list({username, user_short})
        filters = []
        for c in candidates:
            c = c.strip()
            if not c:
                continue
            sc = escape_filter_chars(c)
            filters.extend([
                f"(sAMAccountName={sc})",
                f"(userPrincipalName={sc})",
                f"(mail={sc})",
            ])

        conn.search(
            search_base=base_dn,
            search_filter=f"(&(objectClass=user)(|{''.join(filters)}))",
            attributes=["distinguishedName", "sAMAccountName", "cn"],
            size_limit=5,
        )
        if not conn.entries:
            raise HTTPException(status_code=404, detail=f"Usuário '{username}' não encontrado")
        ua = conn.entries[0].entry_attributes_as_dict
        user_dn = ua.get("distinguishedName", [""])[0]
        user_login = ua.get("sAMAccountName", [""])[0] or username

        ok = conn.modify(group_dn, {"member": [(MODIFY_ADD, [user_dn])]})
        result_code = (conn.result or {}).get("result")

        if not ok:
            if result_code == 68:
                return {"success": True, "message": f"Usuário {user_login} já é membro do grupo {group_cn}", "group": group_cn, "user": user_login}
            detail = (conn.result or {}).get("message") or (conn.result or {}).get("description") or "Erro ao adicionar"
            raise HTTPException(status_code=500, detail=detail)

        return {"success": True, "message": f"Usuário {user_login} adicionado ao grupo {group_cn}", "group": group_cn, "user": user_login}

    except HTTPException:
        raise
    except LDAPException as exc:
        raise HTTPException(status_code=502, detail=f"LDAP error: {exc}") from exc
    finally:
        conn.unbind()
