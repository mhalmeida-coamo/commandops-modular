from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


USERNAME_PATTERN = r"^[a-z0-9._-]{3,64}$"
UPN_PATTERN = r"^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$"


class CreateUserRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    user_type: Literal["estagiario", "terceiro", "usuario"]
    username: str = Field(min_length=3, max_length=64, pattern=USERNAME_PATTERN)
    first_name: str = Field(min_length=1, max_length=120)
    last_name: str = Field(min_length=1, max_length=120)
    full_name: str = Field(min_length=3, max_length=240)
    target_ou: str = Field(min_length=5, max_length=1024)
    user_principal_name: str | None = Field(default=None, max_length=240, pattern=UPN_PATTERN)
    mail: str | None = Field(default=None, max_length=240, pattern=UPN_PATTERN)
    password: str | None = Field(default=None, min_length=8, max_length=256)
    account_expiration_date: str | None = Field(default=None, max_length=32)
    description: str | None = Field(default=None, max_length=512)
    company: str | None = Field(default=None, max_length=240)
    employee_id: str | None = Field(default=None, max_length=80)
    department: str | None = Field(default=None, max_length=240)
    office: str | None = Field(default=None, max_length=240)
    title: str | None = Field(default=None, max_length=240)
    initials: str | None = Field(default=None, max_length=16)
    manager_login: str | None = Field(default=None, max_length=240)
    manager_dn: str | None = Field(default=None, max_length=1024)
    logon_script: str | None = Field(default=None, max_length=240)
    selected_groups: list[str] = Field(default_factory=list, max_length=200)
    vpn_enabled: bool = False
    enabled: bool = True
    must_change_password: bool = True
    dry_run: bool | None = None

    @field_validator("target_ou")
    @classmethod
    def validate_target_ou(cls, value: str) -> str:
        upper = value.upper()
        if "DC=" not in upper or ("OU=" not in upper and "CN=" not in upper):
            raise ValueError("target_ou deve ser um DN valido")
        return value

    @field_validator("selected_groups")
    @classmethod
    def validate_groups(cls, value: list[str]) -> list[str]:
        cleaned: list[str] = []
        for item in value:
            text = str(item or "").strip()
            if not text:
                continue
            if len(text) > 512:
                raise ValueError("grupo informado excede o tamanho permitido")
            cleaned.append(text)
        return cleaned


class CreateUserPlan(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Literal["planned"]
    dry_run: bool
    normalized_username: str
    upn: str
    target_ou: str
    user_type: Literal["estagiario", "terceiro", "usuario"]
    summary: dict


class CreateUserExecuteResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Literal["ok"]
    dry_run: bool
    normalized_username: str
    upn: str
    target_ou: str
    user_type: Literal["estagiario", "terceiro", "usuario"]
    dn: str
    password_applied: bool
    vpn_enabled_applied: bool = False
    enabled: bool
    groups_applied: list[str]
    warnings: list[str] = Field(default_factory=list)


class TransferUserRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    username: str = Field(min_length=3, max_length=120)
    target_ou: str = Field(min_length=5, max_length=1024)
    reason: str = Field(min_length=3, max_length=512)
    selected_groups: list[str] = Field(default_factory=list, max_length=400)
    current_ou_user_groups: list[str] = Field(default_factory=list, max_length=400)
    force_permission_reapply: bool = False
    update_office: bool = False
    new_office: str | None = Field(default=None, max_length=240)
    dry_run: bool | None = None

    @field_validator("target_ou")
    @classmethod
    def validate_transfer_target_ou(cls, value: str) -> str:
        upper = value.upper()
        if "DC=" not in upper or ("OU=" not in upper and "CN=" not in upper):
            raise ValueError("target_ou deve ser um DN valido")
        return value

    @field_validator("selected_groups", "current_ou_user_groups")
    @classmethod
    def validate_transfer_groups(cls, value: list[str]) -> list[str]:
        cleaned: list[str] = []
        for item in value:
            text = str(item or "").strip()
            if not text:
                continue
            if len(text) > 1024:
                raise ValueError("grupo informado excede o tamanho permitido")
            cleaned.append(text)
        return cleaned


class TransferUserResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Literal["ok"]
    dry_run: bool
    username: str
    display_name: str
    old_ou: str
    new_ou: str
    groups_removed: list[str]
    groups_added: list[str]
    already_compliant: bool
    moved: bool
    office_updated: bool
    office_before: str
    office_after: str
    warnings: list[str] = Field(default_factory=list)


class DismissUsersRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    employee_ids: list[str] = Field(default_factory=list, max_length=500)
    target_ou_dn: str = Field(min_length=5, max_length=1024)
    requested_by: str | None = Field(default=None, max_length=240)
    run_as: str | None = Field(default=None, max_length=240)

    @field_validator("target_ou_dn")
    @classmethod
    def validate_target_ou(cls, value: str) -> str:
        upper = value.upper()
        if "DC=" not in upper or ("OU=" not in upper and "CN=" not in upper):
            raise ValueError("target_ou_dn deve ser um DN valido")
        return value

    @field_validator("employee_ids")
    @classmethod
    def validate_employee_ids(cls, value: list[str]) -> list[str]:
        cleaned: list[str] = []
        seen: set[str] = set()
        for item in value:
            text = str(item or "").strip()
            if not text:
                continue
            digits = "".join(ch for ch in text if ch.isdigit())
            if not digits:
                continue
            if digits in seen:
                continue
            seen.add(digits)
            cleaned.append(digits)
        if not cleaned:
            raise ValueError("Informe ao menos uma matrícula válida.")
        return cleaned


class DismissUserItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    employee_id: str
    found: bool
    status: Literal["ok", "not_found"]
    message: str | None = None
    login: str | None = None
    display_name: str | None = None
    original_dn: str | None = None
    destination_dn: str | None = None
    moved: bool | None = None
    removed_groups: list[str] = Field(default_factory=list)
    already_disabled_in_target_ou: bool = False
    warnings: list[str] = Field(default_factory=list)


class DismissUsersResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Literal["ok"]
    input_count: int
    processed_count: int
    success_count: int
    not_found_count: int
    requested_by: str | None = None
    run_as: str | None = None
    results: list[DismissUserItem]


class VpnUserRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    username: str = Field(min_length=3, max_length=240)
    enabled: bool
    requested_by: str | None = Field(default=None, max_length=240)
    run_as: str | None = Field(default=None, max_length=240)


GroupAction = Literal["removed", "added", "already_absent", "already_present", "not_found", "failed"]


class VpnUserResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Literal["ok"]
    username: str
    login: str
    display_name: str
    user_dn: str
    previous_vpn_value: Literal["TRUE", "NOT_SET"]  # valor de msNPAllowDialin antes da operação
    vpn_value: Literal["TRUE", "NOT_SET"]            # valor após a operação
    # CA - Bloqueio Ext: removido ao habilitar VPN, adicionado ao desabilitar
    bloqueio_ext_action: GroupAction
    # InternetMail: adicionado ao habilitar VPN (se ausente), removido ao desabilitar (se Bloqueio_envio presente)
    internet_mail_action: GroupAction
    internet_mail_group: str
    warnings: list[str] = Field(default_factory=list)


def planned_capabilities() -> list[str]:
    return [
        "create_user",
        "set_password",
        "enable_disable_user",
        "move_user",
        "group_membership",
        "transfer_user",
        "dismiss_users",
        "vpn_toggle",
    ]
