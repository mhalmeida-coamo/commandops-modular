import os
import subprocess

from .config import settings


def kerberos_status() -> dict:
    return {
        "realm": settings.realm,
        "domain": settings.domain,
        "krb5_config": settings.krb5_config,
        "keytab_present": settings.keytab_exists,
        "service_principal": settings.service_principal,
    }


def has_ticket() -> bool:
    result = subprocess.run(["klist", "-s"], capture_output=True)
    return result.returncode == 0


def kinit_from_keytab() -> tuple[bool, str]:
    if not settings.keytab_exists:
        return False, "keytab ausente"
    env = os.environ.copy()
    env["KRB5_CONFIG"] = settings.krb5_config
    result = subprocess.run(
        ["kinit", "-k", "-t", settings.keytab_path, settings.service_principal],
        capture_output=True,
        text=True,
        env=env,
    )
    if result.returncode != 0:
        return False, (result.stderr or result.stdout or "falha no kinit").strip()
    return True, "ticket kerberos obtido"
