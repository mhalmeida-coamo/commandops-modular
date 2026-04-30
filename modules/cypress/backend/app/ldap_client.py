"""LDAP operations via ldap3: group member lookup and add-user."""
from __future__ import annotations
import ldap3
from ldap3.core.exceptions import LDAPException


class LdapError(Exception):
    pass


def _connect(server: str, user_dn: str, password: str) -> ldap3.Connection:
    srv = ldap3.Server(server, get_info=ldap3.ALL, connect_timeout=10)
    conn = ldap3.Connection(srv, user=user_dn, password=password, auto_bind=True)
    if not conn.bound:
        raise LdapError(f"LDAP bind falhou para {user_dn}")
    return conn


def get_group_members(
    server: str,
    base_dn: str,
    bind_user_dn: str,
    bind_password: str,
    group_dn: str,
) -> list[dict]:
    """Returns list of {dn, sAMAccountName, displayName} for direct group members."""
    conn = _connect(server, bind_user_dn, bind_password)
    try:
        conn.search(
            search_base=group_dn,
            search_filter="(objectClass=group)",
            search_scope=ldap3.BASE,
            attributes=["member"],
        )
        if not conn.entries:
            return []

        members_dns: list[str] = []
        raw = conn.entries[0]["member"].values
        for dn in raw:
            members_dns.append(str(dn))

        result: list[dict] = []
        for dn in members_dns:
            conn.search(
                search_base=dn,
                search_filter="(objectClass=*)",
                search_scope=ldap3.BASE,
                attributes=["sAMAccountName", "displayName", "mail"],
            )
            if conn.entries:
                e = conn.entries[0]
                result.append({
                    "dn": dn,
                    "sAMAccountName": str(e["sAMAccountName"]) if "sAMAccountName" in e else "",
                    "displayName": str(e["displayName"]) if "displayName" in e else "",
                    "mail": str(e["mail"]) if "mail" in e else "",
                })
            else:
                result.append({"dn": dn, "sAMAccountName": "", "displayName": "", "mail": ""})

        return result
    except LDAPException as exc:
        raise LdapError(str(exc)) from exc
    finally:
        conn.unbind()


def resolve_user_dn(
    conn: ldap3.Connection,
    base_dn: str,
    username: str,
) -> str | None:
    """Find user DN by sAMAccountName, UPN, or mail."""
    filters = [
        f"(sAMAccountName={ldap3.utils.conv.escape_filter_chars(username)})",
        f"(userPrincipalName={ldap3.utils.conv.escape_filter_chars(username)})",
        f"(mail={ldap3.utils.conv.escape_filter_chars(username)})",
    ]
    for f in filters:
        conn.search(
            search_base=base_dn,
            search_filter=f"(&(objectClass=user){f})",
            search_scope=ldap3.SUBTREE,
            attributes=["distinguishedName"],
        )
        if conn.entries:
            return str(conn.entries[0]["distinguishedName"])
    return None


def add_user_to_group(
    server: str,
    base_dn: str,
    bind_user_dn: str,
    bind_password: str,
    group_dn: str,
    username: str,
) -> dict:
    """Add username to AD group. Returns {status, user_dn, message}."""
    conn = _connect(server, bind_user_dn, bind_password)
    try:
        user_dn = resolve_user_dn(conn, base_dn, username)
        if not user_dn:
            return {"status": "not_found", "user_dn": None, "message": f"Usuário '{username}' não encontrado no AD"}

        # Check if already member
        conn.search(
            search_base=group_dn,
            search_filter="(objectClass=group)",
            search_scope=ldap3.BASE,
            attributes=["member"],
        )
        if conn.entries:
            current_members = [str(m) for m in conn.entries[0]["member"].values]
            if any(m.lower() == user_dn.lower() for m in current_members):
                return {"status": "already_member", "user_dn": user_dn, "message": "Usuário já é membro do grupo"}

        ldap3.extend.microsoft.addMembersToGroups.ad_add_members_to_groups(
            conn, [user_dn], [group_dn]
        )
        if conn.result["result"] == 0:
            return {"status": "added", "user_dn": user_dn, "message": "Usuário adicionado ao grupo com sucesso"}
        else:
            return {"status": "failed", "user_dn": user_dn, "message": conn.result.get("description", "Erro LDAP")}

    except LDAPException as exc:
        raise LdapError(str(exc)) from exc
    finally:
        conn.unbind()
