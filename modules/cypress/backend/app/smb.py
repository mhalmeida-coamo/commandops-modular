"""Fetches XML files from SMB share via smbclient subprocess."""
import subprocess
import tempfile
import os


class SmbError(Exception):
    pass


def fetch_smb_file(
    server: str,
    share: str,
    remote_path: str,
    domain: str,
    username: str,
    password: str,
) -> bytes:
    """Download a single file from SMB and return its raw bytes."""
    with tempfile.TemporaryDirectory() as tmpdir:
        local_file = os.path.join(tmpdir, "data.xml")
        cmd = [
            "smbclient",
            f"//{server}/{share}",
            "--user", f"{domain}\\{username}%{password}",
            "--no-pass",
            "--command", f'get "{remote_path}" "{local_file}"',
        ]
        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                timeout=30,
            )
        except subprocess.TimeoutExpired as exc:
            raise SmbError("smbclient timeout ao buscar arquivo") from exc
        except FileNotFoundError as exc:
            raise SmbError("smbclient não encontrado no sistema") from exc

        if result.returncode != 0:
            stderr = result.stderr.decode(errors="replace").strip()
            raise SmbError(f"smbclient erro ({result.returncode}): {stderr}")

        try:
            with open(local_file, "rb") as fh:
                return fh.read()
        except FileNotFoundError as exc:
            raise SmbError("Arquivo não encontrado no compartilhamento SMB") from exc
