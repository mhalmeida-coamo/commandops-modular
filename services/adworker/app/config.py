from dataclasses import dataclass
from pathlib import Path
import os


def _as_bool(value: str | None, default: bool = False) -> bool:
    if value is None:
        return default
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Settings:
    host: str = os.getenv("AD_WORKER_HOST", "0.0.0.0")
    port: int = int(os.getenv("AD_WORKER_PORT", "8010"))
    realm: str = os.getenv("AD_REALM", "COAMO.COM.BR")
    domain: str = os.getenv("AD_DOMAIN", "coamo.com.br")
    base_dn: str = os.getenv("AD_BASE_DN", "DC=coamo,DC=com,DC=br")
    ldap_server: str = os.getenv("AD_LDAP_SERVER", "172.16.0.15")
    ldap_port: int = int(os.getenv("AD_LDAP_PORT", "389"))
    krb5_config: str = os.getenv("AD_KRB5_CONFIG", "/etc/krb5.conf")
    keytab_path: str = os.getenv("AD_KEYTAB_PATH", "/run/secrets/svc_infratools_ad.keytab")
    service_principal: str = os.getenv("AD_SERVICE_PRINCIPAL", "svc_infratools_ad@COAMO.COM.BR")
    api_token: str = os.getenv("AD_WORKER_API_TOKEN", "")
    auto_kinit: bool = _as_bool(os.getenv("AD_WORKER_AUTO_KINIT"), default=False)
    allow_password_ops: bool = _as_bool(os.getenv("AD_WORKER_ALLOW_PASSWORD_OPS"), default=False)
    default_dry_run: bool = _as_bool(os.getenv("AD_WORKER_DEFAULT_DRY_RUN"), default=True)

    @property
    def keytab_exists(self) -> bool:
        return Path(self.keytab_path).exists()

    @property
    def token_configured(self) -> bool:
        return bool(self.api_token.strip())


settings = Settings()
