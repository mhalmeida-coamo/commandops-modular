from contextlib import asynccontextmanager
from datetime import datetime, timezone
import os

from fastapi import Depends, FastAPI, HTTPException, status
from ldap3 import ALL, BASE, MODIFY_ADD, MODIFY_DELETE, MODIFY_REPLACE, SASL, KERBEROS, ENCRYPT, Connection, Server
from ldap3.core.exceptions import LDAPAttributeOrValueExistsResult, LDAPEntryAlreadyExistsResult, LDAPException
from ldap3.utils.conv import escape_filter_chars

from .config import settings
from .kerberos import has_ticket, kinit_from_keytab, kerberos_status
from .operations import (
    CreateUserExecuteResult,
    CreateUserPlan,
    CreateUserRequest,
    DismissUserItem,
    DismissUsersRequest,
    DismissUsersResult,
    TransferUserRequest,
    TransferUserResult,
    VpnUserRequest,
    VpnUserResult,
    planned_capabilities,
)
from .security import require_api_token


def _build_upn(username: str, upn: str | None) -> str:
    return (upn or f"{username}@{settings.domain}").strip().lower()


def _plan_create_user(payload: CreateUserRequest) -> CreateUserPlan:
    normalized_username = payload.username.strip().lower()
    dry_run = settings.default_dry_run if payload.dry_run is None else payload.dry_run
    return CreateUserPlan(
        status="planned",
        dry_run=bool(dry_run),
        normalized_username=normalized_username,
        upn=_build_upn(normalized_username, payload.user_principal_name),
        target_ou=payload.target_ou,
        user_type=payload.user_type,
        summary={
            "full_name": payload.full_name,
            "groups_requested": len(payload.selected_groups),
            "password_requested": bool(payload.password),
            "password_execution_allowed": bool(settings.allow_password_ops),
            "enabled_requested": payload.enabled,
            "must_change_password_requested": payload.must_change_password,
        },
    )


def _build_user_dn(payload: CreateUserRequest) -> str:
    cn_value = payload.full_name.replace(",", "\\,").strip()
    return f"CN={cn_value},{payload.target_ou}"


def _first_attr(attrs: dict, key: str) -> str:
    value = attrs.get(key)
    if isinstance(value, list):
        return str(value[0]) if value else ""
    return str(value or "")


def _parse_expiration(value: str | None) -> int | None:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        parsed = datetime.strptime(text, "%Y-%m-%d")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Data de expiração inválida.") from exc
    parsed = parsed.replace(hour=23, minute=59, second=59, tzinfo=timezone.utc)
    epoch = datetime(1601, 1, 1, tzinfo=timezone.utc)
    delta = parsed - epoch
    return int(delta.total_seconds() * 10_000_000)


def _ensure_ticket() -> None:
    if has_ticket():
        return
    ok, message = kinit_from_keytab()
    if not ok:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=message)


def _connect_ldap() -> Connection:
    env = os.environ.copy()
    env["KRB5_CONFIG"] = settings.krb5_config
    os.environ["KRB5_CONFIG"] = settings.krb5_config
    server = Server(settings.ldap_server, port=settings.ldap_port, use_ssl=False, get_info=ALL)
    try:
        return Connection(
            server,
            authentication=SASL,
            sasl_mechanism=KERBEROS,
            session_security=ENCRYPT,
            auto_bind=True,
            auto_referrals=False,
            raise_exceptions=True,
        )
    except LDAPException as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Falha ao conectar no LDAP via Kerberos: {exc}") from exc


def _resolve_manager_dn(conn: Connection, manager_login: str | None) -> str | None:
    login = str(manager_login or "").strip().lower()
    if not login:
        return None
    safe_login = escape_filter_chars(login)
    conn.search(
        search_base=settings.base_dn,
        search_filter=(
            "(&(objectCategory=person)(objectClass=user)"
            f"(sAMAccountName={safe_login}))"
        ),
        attributes=["distinguishedName"],
        size_limit=1,
    )
    if not conn.entries:
        raise HTTPException(status_code=400, detail="Gerente informado não foi localizado no AD.")
    return _first_attr(conn.entries[0].entry_attributes_as_dict, "distinguishedName")


def _resolve_group_dn(conn: Connection, group_value: str) -> tuple[str, str]:
    raw = str(group_value or "").strip()
    if not raw:
        raise HTTPException(status_code=400, detail="Grupo inválido.")
    if "DC=" in raw.upper() and "," in raw:
        conn.search(raw, "(objectClass=group)", attributes=["cn", "sAMAccountName"], size_limit=1)
        if not conn.entries:
            raise HTTPException(status_code=400, detail=f"Grupo '{raw}' não encontrado.")
        attrs = conn.entries[0].entry_attributes_as_dict
        name = _first_attr(attrs, "sAMAccountName") or _first_attr(attrs, "cn") or raw
        return raw, name
    safe_value = escape_filter_chars(raw)
    conn.search(
        search_base=settings.base_dn,
        search_filter=f"(&(objectClass=group)(|(sAMAccountName={safe_value})(cn={safe_value})(name={safe_value})))",
        attributes=["distinguishedName", "cn", "sAMAccountName"],
        size_limit=1,
    )
    if not conn.entries:
        raise HTTPException(status_code=400, detail=f"Grupo '{raw}' não encontrado.")
    attrs = conn.entries[0].entry_attributes_as_dict
    dn = _first_attr(attrs, "distinguishedName")
    name = _first_attr(attrs, "sAMAccountName") or _first_attr(attrs, "cn") or raw
    return dn, name


PROTECTED_GROUP_KEYWORDS = (
    "DOMAIN USERS",
    "DENIED RODC PASSWORD REPLICATION GROUP",
    "USERS",
)

DISMISS_LICENSE_GROUP_EXACT = {"LICENCAS_O365_GERAL"}
DISMISS_LICENSE_GROUP_PREFIXES = ("LICENCAS_M365_E3",)
VPN_CA_BLOCK_GROUP = "CA - Bloqueio Ext"
VPN_LEGACY_BLOCK_GROUP = "Bloqueio_Webmail"
VPN_BLOCK_EMAIL_GROUP = "Bloqueio_envio_Email_Externo_Office365"


def _internet_mail_cn_for_company(company: str) -> str:
    upper = "".join(
        c for c in company.upper()
        if c.isalpha() or c == " "
    ).strip()
    if "CREDICOAMO SEGUROS" in upper or "CREDICOAMOSEGUROS" in upper:
        return "InternetMail - CredicoamoSeguros"
    if "VIA SOLLUS" in upper or "VIASOLLUS" in upper:
        return "InternetMail - Via Sollus"
    if "CREDICOAMO" in upper:
        return "InternetMail - Credicoamo"
    if "FUPS" in upper:
        return "InternetMail - FUPS"
    if "ARCAM" in upper:
        return "InternetMail - ARCAM"
    return "InternetMail"


def _group_action_modify(
    conn: Connection,
    group_dn: str,
    group_name: str,
    user_dn: str,
    member_dns_upper: set[str],
    add: bool,
    warnings: list[str],
) -> str:
    """Adiciona ou remove o usuário de um grupo. Retorna o group_action."""
    in_group = group_dn.upper() in member_dns_upper
    if add:
        if in_group:
            return "already_present"
        try:
            ok = conn.modify(group_dn, {"member": [(MODIFY_ADD, [user_dn])]})
            if ok:
                return "added"
            warnings.append(conn.result.get("message") or conn.last_error or f"Falha ao adicionar '{group_name}'.")
            return "failed"
        except (LDAPAttributeOrValueExistsResult, LDAPEntryAlreadyExistsResult):
            return "already_present"
        except LDAPException as exc:
            warnings.append(f"Falha ao adicionar '{group_name}': {exc}")
            return "failed"
    else:
        if not in_group:
            return "already_absent"
        try:
            ok = conn.modify(group_dn, {"member": [(MODIFY_DELETE, [user_dn])]})
            if ok:
                return "removed"
            warnings.append(conn.result.get("message") or conn.last_error or f"Falha ao remover '{group_name}'.")
            return "failed"
        except LDAPException as exc:
            warnings.append(f"Falha ao remover '{group_name}': {exc}")
            return "failed"


def _resolve_user_dn(conn: Connection, login: str) -> str:
    login_norm = str(login or "").strip()
    if not login_norm:
        raise HTTPException(status_code=400, detail="Usuário é obrigatório.")
    if "\\" in login_norm:
        login_norm = login_norm.split("\\")[-1]
    if "CN=" in login_norm.upper() and "," in login_norm:
        return login_norm

    safe = escape_filter_chars(login_norm)
    conn.search(
        search_base=settings.base_dn,
        search_filter=(
            "(&(objectClass=person)"
            f"(|(sAMAccountName={safe})(mail={safe})(userPrincipalName={safe})))"
        ),
        attributes=["distinguishedName", "sAMAccountName"],
        size_limit=1,
    )
    if not conn.entries:
        raise HTTPException(status_code=404, detail=f"Usuário não encontrado: {login_norm}")
    return str(conn.entries[0].entry_dn)


def _extract_parent_dn(dn: str) -> str:
    if not dn or "," not in dn:
        return ""
    return dn.split(",", 1)[1]


def _resolve_group_name(group_dn: str) -> str:
    first = str(group_dn or "").split(",", 1)[0].strip()
    if first.upper().startswith("CN="):
        return first[3:]
    return first or str(group_dn or "")


def _is_protected_group(group_name: str) -> bool:
    upper = str(group_name or "").upper()
    return any(keyword in upper for keyword in PROTECTED_GROUP_KEYWORDS)


def _get_member_of(conn: Connection, user_dn: str) -> list[str]:
    try:
        ok = conn.search(
            search_base=user_dn,
            search_filter="(objectClass=*)",
            search_scope=BASE,
            attributes=["memberOf"],
            size_limit=1,
        )
    except LDAPException:
        return []
    if not ok or not conn.entries:
        return []
    attrs = conn.entries[0].entry_attributes_as_dict
    groups = attrs.get("memberOf") or []
    if isinstance(groups, str):
        return [groups]
    return [str(item) for item in groups]


def _normalize_employee_id(value: str) -> str:
    return "".join(ch for ch in str(value or "") if ch.isdigit())


def _employee_id_candidates(digits: str) -> list[str]:
    candidates = [digits]
    if len(digits) > 1:
        body, check = digits[:-1], digits[-1]
        candidates.append(f"{body}-{check}")
        groups: list[str] = []
        while body:
            groups.insert(0, body[-3:])
            body = body[:-3]
        if groups:
            candidates.append(f"{'.'.join(groups)}-{check}")
    unique: list[str] = []
    seen: set[str] = set()
    for item in candidates:
        text = str(item or "").strip()
        if not text or text in seen:
            continue
        seen.add(text)
        unique.append(text)
    return unique


def _is_license_group(group_name: str) -> bool:
    upper = str(group_name or "").strip().upper()
    if not upper:
        return False
    if upper in DISMISS_LICENSE_GROUP_EXACT:
        return True
    return any(upper.startswith(prefix) for prefix in DISMISS_LICENSE_GROUP_PREFIXES)


def _first_entry_by_employee_id(entries: list, employee_digits: str):
    if not entries:
        return None
    for entry in entries:
        attrs = entry.entry_attributes_as_dict if hasattr(entry, "entry_attributes_as_dict") else {}
        value = _first_attr(attrs, "employeeID")
        if _normalize_employee_id(value) == employee_digits:
            return entry
    return entries[0]


def _build_attributes(payload: CreateUserRequest, manager_dn: str | None) -> dict:
    attrs = {
        "cn": payload.full_name,
        "displayName": payload.full_name,
        "givenName": payload.first_name,
        "sn": payload.last_name,
        "initials": payload.initials or "",
        "sAMAccountName": payload.username,
        "userPrincipalName": _build_upn(payload.username, payload.user_principal_name),
        "mail": payload.mail or "",
        "company": payload.company or "",
        "employeeID": payload.employee_id or "",
        "description": payload.description or "",
        "scriptPath": payload.logon_script or "",
        "userAccountControl": 514,
    }
    if payload.user_type in {"estagiario", "usuario"}:
        attrs["physicalDeliveryOfficeName"] = payload.office or ""
        attrs["title"] = payload.title or ""
        attrs["department"] = payload.department or ""
    if manager_dn:
        attrs["manager"] = manager_dn
    expiration = _parse_expiration(getattr(payload, "account_expiration_date", None))
    if expiration:
        attrs["accountExpires"] = expiration
    return {key: value for key, value in attrs.items() if value not in {"", None}}


def _rollback_user(conn: Connection, user_dn: str) -> None:
    try:
        conn.delete(user_dn)
    except LDAPException:
        return


def _apply_vpn_dialin(conn: Connection, user_dn: str, enabled: bool) -> bool:
    if not enabled:
        return False
    ok = conn.modify(user_dn, {"msNPAllowDialin": [(MODIFY_REPLACE, ["TRUE"])]})
    if not ok:
        detail = conn.result.get("message") or conn.last_error or "Falha ao habilitar VPN no Dial-in."
        raise HTTPException(status_code=502, detail=detail)
    return True


def _execute_create_user(payload: CreateUserRequest) -> CreateUserExecuteResult:
    if payload.password and not settings.allow_password_ops:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Operações de senha estão desabilitadas no ad-worker.",
        )
    if payload.dry_run:
        raise HTTPException(status_code=400, detail="Use o endpoint de plan para dry-run.")

    _ensure_ticket()
    conn = _connect_ldap()
    user_dn = _build_user_dn(payload)
    created = False
    warnings: list[str] = []
    applied_groups: list[str] = []
    try:
        safe_login = escape_filter_chars(payload.username)
        conn.search(
            search_base=settings.base_dn,
            search_filter=(
                "(&(objectCategory=person)(objectClass=user)"
                f"(|(sAMAccountName={safe_login})(userPrincipalName={safe_login})))"
            ),
            attributes=["distinguishedName"],
            size_limit=1,
        )
        if conn.entries:
            raise HTTPException(status_code=409, detail="Já existe um usuário com esse login no AD.")

        manager_dn = str(payload.manager_dn or "").strip() or _resolve_manager_dn(conn, payload.manager_login)
        attributes = _build_attributes(payload, manager_dn)
        ok = conn.add(user_dn, ["top", "person", "organizationalPerson", "user"], attributes)
        if not ok:
            raise HTTPException(status_code=502, detail=conn.result.get("message") or conn.last_error or "Falha ao criar usuário no AD.")
        created = True

        password_applied = False
        if payload.password:
            try:
                ok = conn.extend.microsoft.modify_password(user_dn, payload.password)
            except LDAPException:
                ok = False
            if not ok:
                warnings.append(
                    "Conta criada sem senha inicial: o AD recusou a operação de senha no canal atual."
                )
            else:
                password_applied = True
                pwd_last_set = 0 if payload.must_change_password else -1
                conn.modify(user_dn, {"pwdLastSet": [(MODIFY_REPLACE, [pwd_last_set])]})

        desired_uac = 512 if payload.enabled and password_applied else 514
        conn.modify(user_dn, {"userAccountControl": [(MODIFY_REPLACE, [desired_uac])]})
        if desired_uac != 512:
            warnings.append("Conta criada desabilitada até confirmação segura de senha.")

        vpn_enabled_applied = _apply_vpn_dialin(conn, user_dn, bool(payload.vpn_enabled))

        for group in payload.selected_groups:
            group_dn, group_name = _resolve_group_dn(conn, group)
            try:
                conn.modify(group_dn, {"member": [(MODIFY_ADD, [user_dn])]})
                applied_groups.append(group_name)
            except LDAPException as exc:
                warnings.append(f"Grupo '{group_name}' não pôde ser aplicado: {exc}")

        return CreateUserExecuteResult(
            status="ok",
            dry_run=False,
            normalized_username=payload.username.strip().lower(),
            upn=_build_upn(payload.username, payload.user_principal_name),
            target_ou=payload.target_ou,
            user_type=payload.user_type,
            dn=user_dn,
            password_applied=password_applied,
            vpn_enabled_applied=vpn_enabled_applied,
            enabled=bool(desired_uac == 512),
            groups_applied=applied_groups,
            warnings=warnings,
        )
    except HTTPException:
        if created:
            _rollback_user(conn, user_dn)
        raise
    except LDAPException as exc:
        if created:
            _rollback_user(conn, user_dn)
        raise HTTPException(status_code=502, detail=f"Falha LDAP no ad-worker: {exc}") from exc
    finally:
        conn.unbind()


def _execute_transfer_user(payload: TransferUserRequest) -> TransferUserResult:
    if payload.dry_run:
        raise HTTPException(status_code=400, detail="Use o endpoint de execute para transferência real.")

    if payload.update_office and not str(payload.new_office or "").strip():
        raise HTTPException(status_code=400, detail="Informe o novo Office para atualizar durante a transferência.")

    _ensure_ticket()
    conn = _connect_ldap()
    warnings: list[str] = []
    try:
        user_dn = _resolve_user_dn(conn, payload.username)
        ok = conn.search(
            search_base=user_dn,
            search_filter="(objectClass=*)",
            search_scope=BASE,
            attributes=["displayName", "physicalDeliveryOfficeName", "memberOf", "distinguishedName", "sAMAccountName"],
            size_limit=1,
        )
        if not ok or not conn.entries:
            raise HTTPException(status_code=404, detail="Usuário não encontrado para transferência.")

        attrs = conn.entries[0].entry_attributes_as_dict
        current_dn = _first_attr(attrs, "distinguishedName") or user_dn
        current_ou = _extract_parent_dn(current_dn)
        current_rdn = current_dn.split(",", 1)[0]
        current_office = _first_attr(attrs, "physicalDeliveryOfficeName")
        current_group_dns = _get_member_of(conn, current_dn)
        current_group_map = {dn.upper(): dn for dn in current_group_dns}
        current_group_names = {_resolve_group_name(dn).upper(): dn for dn in current_group_dns}

        selected_group_dns: list[str] = []
        for group in payload.selected_groups:
            group_value = str(group or "").strip()
            if not group_value:
                continue
            try:
                selected_group_dns.append(_resolve_group_dn(conn, group_value)[0])
            except HTTPException:
                continue

        removable_candidates: list[str] = []
        for group in payload.current_ou_user_groups:
            group_value = str(group or "").strip()
            if not group_value:
                continue
            try:
                removable_candidates.append(_resolve_group_dn(conn, group_value)[0])
            except HTTPException:
                continue

        moved = False
        if current_ou.upper() != payload.target_ou.upper():
            ok = conn.modify_dn(current_dn, current_rdn, new_superior=payload.target_ou)
            if not ok:
                detail = conn.result.get("message") or conn.last_error or "Falha ao mover usuário para a OU."
                raise HTTPException(status_code=502, detail=detail)
            moved = True
            user_dn = f"{current_rdn},{payload.target_ou}"
        else:
            user_dn = current_dn

        groups_removed: list[str] = []
        groups_added: list[str] = []
        selected_upper = {dn.upper() for dn in selected_group_dns}

        for group_dn in removable_candidates:
            original_dn = current_group_map.get(group_dn.upper()) or current_group_names.get(_resolve_group_name(group_dn).upper())
            if not original_dn:
                continue
            group_name = _resolve_group_name(original_dn)
            if _is_protected_group(group_name):
                continue
            if original_dn.upper() in selected_upper:
                continue
            try:
                ok = conn.modify(original_dn, {"member": [(MODIFY_DELETE, [user_dn])]})
                if ok:
                    groups_removed.append(group_name)
            except LDAPException as exc:
                warnings.append(f"Falha ao remover grupo '{group_name}': {exc}")

        for group_dn in selected_group_dns:
            group_name = _resolve_group_name(group_dn)
            if group_dn.upper() in current_group_map and not payload.force_permission_reapply:
                continue

            if group_dn.upper() in current_group_map and payload.force_permission_reapply:
                try:
                    conn.modify(group_dn, {"member": [(MODIFY_DELETE, [user_dn])]})
                except LDAPException:
                    # Se nao foi possivel remover, seguimos para o ADD para manter o fluxo resiliente.
                    pass

            try:
                ok = conn.modify(group_dn, {"member": [(MODIFY_ADD, [user_dn])]})
                if ok:
                    groups_added.append(group_name)
            except (LDAPAttributeOrValueExistsResult, LDAPEntryAlreadyExistsResult):
                # Operacao idempotente: o usuario ja esta no grupo.
                continue
            except LDAPException as exc:
                warnings.append(f"Falha ao adicionar grupo '{group_name}': {exc}")

        office_updated = False
        office_after = current_office
        if payload.update_office:
            office_after = str(payload.new_office or "").strip()
            ok = conn.modify(
                user_dn,
                {"physicalDeliveryOfficeName": [(MODIFY_REPLACE, [office_after] if office_after else [])]},
            )
            if not ok:
                detail = conn.result.get("message") or conn.last_error or "Falha ao atualizar Office."
                raise HTTPException(status_code=502, detail=detail)
            office_updated = True

        already_compliant = (
            not moved
            and not groups_removed
            and not groups_added
            and (not payload.update_office or current_office == office_after)
        )

        return TransferUserResult(
            status="ok",
            dry_run=False,
            username=str(payload.username or "").strip(),
            display_name=_first_attr(attrs, "displayName") or str(payload.username or "").strip(),
            old_ou=current_ou,
            new_ou=payload.target_ou,
            groups_removed=groups_removed,
            groups_added=groups_added,
            already_compliant=already_compliant,
            moved=moved,
            office_updated=office_updated,
            office_before=current_office,
            office_after=office_after,
            warnings=warnings,
        )
    except LDAPException as exc:
        raise HTTPException(status_code=502, detail=f"Falha LDAP no ad-worker: {exc}") from exc
    finally:
        conn.unbind()


def _execute_dismiss_users(payload: DismissUsersRequest) -> DismissUsersResult:
    _ensure_ticket()
    conn = _connect_ldap()
    results: list[DismissUserItem] = []
    try:
        for employee_id in payload.employee_ids:
            candidates = _employee_id_candidates(employee_id)
            filter_parts = "".join(f"(employeeID={escape_filter_chars(item)})" for item in candidates)
            search_filter = f"(&(objectCategory=person)(objectClass=user)(|{filter_parts}))"
            conn.search(
                search_base=settings.base_dn,
                search_filter=search_filter,
                attributes=[
                    "distinguishedName",
                    "sAMAccountName",
                    "displayName",
                    "employeeID",
                    "memberOf",
                    "userAccountControl",
                ],
                size_limit=20,
            )
            selected = _first_entry_by_employee_id(list(conn.entries), employee_id)
            if not selected:
                results.append(
                    DismissUserItem(
                        employee_id=employee_id,
                        found=False,
                        status="not_found",
                        message=f"Usuário com employeeID {employee_id} não encontrado.",
                    )
                )
                continue

            attrs = selected.entry_attributes_as_dict if hasattr(selected, "entry_attributes_as_dict") else {}
            user_dn = _first_attr(attrs, "distinguishedName") or str(selected.entry_dn or "").strip()
            login = _first_attr(attrs, "sAMAccountName")
            display_name = _first_attr(attrs, "displayName") or login
            original_dn = user_dn
            warnings: list[str] = []
            removed_groups: list[str] = []

            uac_value = _first_attr(attrs, "userAccountControl") or "512"
            try:
                current_uac = int(uac_value)
            except ValueError:
                current_uac = 512
            is_disabled = bool(current_uac & 2)
            already_in_target_ou = original_dn.upper().endswith("," + payload.target_ou_dn.upper())
            already_disabled_in_target_ou = is_disabled and already_in_target_ou

            if not is_disabled:
                new_uac = current_uac | 2
                ok_disable = conn.modify(user_dn, {"userAccountControl": [(MODIFY_REPLACE, [new_uac])]})
                if not ok_disable:
                    detail = conn.result.get("message") or conn.last_error or "Falha ao desativar conta."
                    raise HTTPException(status_code=502, detail=detail)

            member_dns = attrs.get("memberOf") or []
            if isinstance(member_dns, str):
                member_dns = [member_dns]
            for group_dn in [str(item) for item in member_dns if str(item).strip()]:
                group_name = _resolve_group_name(group_dn)
                if not _is_license_group(group_name):
                    continue
                try:
                    ok = conn.modify(group_dn, {"member": [(MODIFY_DELETE, [user_dn])]})
                    if ok:
                        removed_groups.append(group_name)
                except LDAPException as exc:
                    warnings.append(f"Falha ao remover grupo '{group_name}': {exc}")

            moved = False
            destination_dn = original_dn
            if not already_in_target_ou:
                relative_dn = original_dn.split(",", 1)[0]
                ok_move = conn.modify_dn(original_dn, relative_dn, new_superior=payload.target_ou_dn, delete_old_dn=True)
                if not ok_move:
                    detail = conn.result.get("message") or conn.last_error or "Falha ao mover usuário."
                    raise HTTPException(status_code=502, detail=detail)
                moved = True
                destination_dn = f"{relative_dn},{payload.target_ou_dn}"

            results.append(
                DismissUserItem(
                    employee_id=employee_id,
                    found=True,
                    status="ok",
                    login=login,
                    display_name=display_name,
                    original_dn=original_dn,
                    destination_dn=destination_dn,
                    moved=moved,
                    removed_groups=sorted(set(removed_groups)),
                    already_disabled_in_target_ou=already_disabled_in_target_ou,
                    message="Conta já consta como desativada" if already_disabled_in_target_ou else None,
                    warnings=warnings,
                )
            )

        success_count = sum(1 for item in results if item.status == "ok")
        not_found_count = sum(1 for item in results if item.status == "not_found")
        return DismissUsersResult(
            status="ok",
            input_count=len(payload.employee_ids),
            processed_count=len(results),
            success_count=success_count,
            not_found_count=not_found_count,
            requested_by=payload.requested_by,
            run_as=payload.run_as,
            results=results,
        )
    except LDAPException as exc:
        raise HTTPException(status_code=502, detail=f"Falha LDAP no ad-worker: {exc}") from exc
    finally:
        conn.unbind()


def _execute_vpn_user(payload: VpnUserRequest) -> VpnUserResult:
    _ensure_ticket()
    conn = _connect_ldap()
    warnings: list[str] = []
    try:
        user_dn = _resolve_user_dn(conn, payload.username)
        ok = conn.search(
            search_base=user_dn,
            search_filter="(objectClass=*)",
            search_scope=BASE,
            attributes=["displayName", "sAMAccountName", "distinguishedName", "memberOf", "company"],
            size_limit=1,
        )
        if not ok or not conn.entries:
            raise HTTPException(status_code=404, detail="Usuário não encontrado para atualização de VPN.")

        attrs = conn.entries[0].entry_attributes_as_dict
        login = _first_attr(attrs, "sAMAccountName") or str(payload.username or "").strip()
        display_name = _first_attr(attrs, "displayName") or login
        current_dn = _first_attr(attrs, "distinguishedName") or user_dn
        company = _first_attr(attrs, "company")

        # Atualiza msNPAllowDialin
        if payload.enabled:
            ok_dialin = conn.modify(current_dn, {"msNPAllowDialin": [(MODIFY_REPLACE, ["TRUE"])]})
            if not ok_dialin:
                detail = conn.result.get("message") or conn.last_error or "Falha ao definir msNPAllowDialin=TRUE."
                raise HTTPException(status_code=502, detail=detail)
            vpn_value: str = "TRUE"
        else:
            ok_dialin = conn.modify(current_dn, {"msNPAllowDialin": [(MODIFY_DELETE, [])]})
            if not ok_dialin:
                detail = conn.result.get("message") or conn.last_error or "Falha ao limpar msNPAllowDialin."
                raise HTTPException(status_code=502, detail=detail)
            vpn_value = "NOT_SET"

        member_dns = _get_member_of(conn, current_dn)
        member_dns_upper = {str(d).strip().upper() for d in member_dns}

        # --- CA - Bloqueio Ext ---
        # Habilitar VPN: remove o grupo. Desabilitar VPN: adiciona o grupo.
        try:
            ca_block_dn, _ = _resolve_group_dn(conn, VPN_CA_BLOCK_GROUP)
            bloqueio_ext_action: str = _group_action_modify(
                conn, ca_block_dn, VPN_CA_BLOCK_GROUP, current_dn,
                member_dns_upper, add=not payload.enabled, warnings=warnings,
            )
        except HTTPException:
            warnings.append(f"Grupo '{VPN_CA_BLOCK_GROUP}' não encontrado no AD.")
            bloqueio_ext_action = "not_found"

        # --- Bloqueio_Webmail (grupo legado) ---
        # Ao habilitar VPN: remove o grupo legado se o usuário ainda o possuir.
        # Ao desabilitar VPN: não adiciona — o grupo correto é CA - Bloqueio Ext.
        if payload.enabled:
            try:
                legacy_dn, _ = _resolve_group_dn(conn, VPN_LEGACY_BLOCK_GROUP)
                legacy_action = _group_action_modify(
                    conn, legacy_dn, VPN_LEGACY_BLOCK_GROUP, current_dn,
                    member_dns_upper, add=False, warnings=warnings,
                )
                if legacy_action == "removed":
                    warnings.append(f"Grupo legado '{VPN_LEGACY_BLOCK_GROUP}' removido — usuário migrado para '{VPN_CA_BLOCK_GROUP}'.")
            except HTTPException:
                pass  # Grupo legado não existe mais no AD — sem ação necessária

        # --- InternetMail ---
        internet_mail_cn = _internet_mail_cn_for_company(company)
        internet_mail_action: str = "not_found"
        try:
            im_dn, _ = _resolve_group_dn(conn, internet_mail_cn)
            if payload.enabled:
                # Habilitar VPN: garante InternetMail (adiciona se ausente)
                internet_mail_action = _group_action_modify(
                    conn, im_dn, internet_mail_cn, current_dn,
                    member_dns_upper, add=True, warnings=warnings,
                )
            else:
                # Desabilitar VPN: remove InternetMail apenas se o usuário
                # possui Bloqueio_envio_Email_Externo_Office365
                try:
                    block_email_dn, _ = _resolve_group_dn(conn, VPN_BLOCK_EMAIL_GROUP)
                    has_block_email = block_email_dn.upper() in member_dns_upper
                except HTTPException:
                    has_block_email = False

                if has_block_email:
                    internet_mail_action = _group_action_modify(
                        conn, im_dn, internet_mail_cn, current_dn,
                        member_dns_upper, add=False, warnings=warnings,
                    )
                else:
                    internet_mail_action = "already_present"
        except HTTPException:
            warnings.append(f"Grupo InternetMail '{internet_mail_cn}' não encontrado no AD.")

        return VpnUserResult(
            status="ok",
            username=str(payload.username or "").strip(),
            login=login,
            display_name=display_name,
            user_dn=current_dn,
            vpn_value=vpn_value,
            bloqueio_ext_action=bloqueio_ext_action,
            internet_mail_action=internet_mail_action,
            internet_mail_group=internet_mail_cn,
            warnings=warnings,
        )
    except LDAPException as exc:
        raise HTTPException(status_code=502, detail=f"Falha LDAP no ad-worker: {exc}") from exc
    finally:
        conn.unbind()


@asynccontextmanager
async def lifespan(_: FastAPI):
    if settings.auto_kinit and settings.token_configured and settings.keytab_exists and not has_ticket():
        kinit_from_keytab()
    yield


app = FastAPI(title="CommandOps AD Worker", version="1.2.0", lifespan=lifespan)


@app.get("/health")
def health():
    return {
        "status": "ok",
        "component": "ad-worker",
        "kerberos": kerberos_status(),
        "ldap": {
            "server": settings.ldap_server,
            "port": settings.ldap_port,
        },
        "ticket_loaded": has_ticket(),
        "capabilities": planned_capabilities(),
    }


@app.get("/health/ready")
def ready():
    ready_state = settings.token_configured and settings.keytab_exists and has_ticket()
    return {
        "ready": ready_state,
        "token_configured": settings.token_configured,
        "keytab_present": settings.keytab_exists,
        "ticket_loaded": has_ticket(),
    }


@app.post("/auth/kinit", dependencies=[Depends(require_api_token)])
def auth_kinit():
    ok, message = kinit_from_keytab()
    if not ok:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=message)
    return {"ok": ok, "message": message}


@app.get("/capabilities", dependencies=[Depends(require_api_token)])
def capabilities():
    return {"items": planned_capabilities()}


@app.post("/operations/create-user/plan", dependencies=[Depends(require_api_token)])
def create_user_plan(payload: CreateUserRequest):
    return _plan_create_user(payload)


@app.post("/operations/create-user/execute", dependencies=[Depends(require_api_token)])
def create_user_execute(payload: CreateUserRequest):
    return _execute_create_user(payload)


@app.post("/operations/transfer-user/execute", dependencies=[Depends(require_api_token)])
def transfer_user_execute(payload: TransferUserRequest):
    return _execute_transfer_user(payload)


@app.post("/operations/dismiss-users/execute", dependencies=[Depends(require_api_token)])
def dismiss_users_execute(payload: DismissUsersRequest):
    return _execute_dismiss_users(payload)


@app.post("/operations/vpn-user/execute", dependencies=[Depends(require_api_token)])
def vpn_user_execute(payload: VpnUserRequest):
    return _execute_vpn_user(payload)
