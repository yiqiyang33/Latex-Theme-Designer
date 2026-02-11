#!/usr/bin/env python3
"""HTTP server layer for Theme Designer."""

from __future__ import annotations

import argparse
import errno
import json
import re
import threading
import time
import uuid
import webbrowser
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Dict
from urllib.parse import parse_qs, urlparse

try:
    from tools.theme_designer_core import (
        STATE_LOCK,
        _apply_block_preset,
        _apply_heading_toc_preset,
        _apply_compile_preferences,
        _apply_compile_result,
        _build_response_state,
        _compile_tex_target,
        _extract_compile_preferences,
        _delete_override_files,
        _load_state,
        _normalize_compile_target,
        _normalize_payload,
        _persist_ui_state,
        _resolve_workspace_pdf,
        _write_override_files,
    )
    from tools.theme_designer_ui import HTML_PAGE
except ModuleNotFoundError:
    from theme_designer_core import (
        STATE_LOCK,
        _apply_block_preset,
        _apply_heading_toc_preset,
        _apply_compile_preferences,
        _apply_compile_result,
        _build_response_state,
        _compile_tex_target,
        _extract_compile_preferences,
        _delete_override_files,
        _load_state,
        _normalize_compile_target,
        _normalize_payload,
        _persist_ui_state,
        _resolve_workspace_pdf,
        _write_override_files,
    )
    from theme_designer_ui import HTML_PAGE


DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8765
AUTO_PORT_START = DEFAULT_PORT
PORT_AUTO = "auto"

LIFECYCLE_MODE_MANUAL = "manual"
LIFECYCLE_MODE_SHUTDOWN_ON_LAST_TAB = "shutdown-on-last-tab"
LIFECYCLE_MODES = (
    LIFECYCLE_MODE_MANUAL,
    LIFECYCLE_MODE_SHUTDOWN_ON_LAST_TAB,
)
DEFAULT_LIFECYCLE_MODE = LIFECYCLE_MODE_MANUAL
DEFAULT_SESSION_TIMEOUT_SEC = 45.0
DEFAULT_IDLE_GRACE_SEC = 20.0
DEFAULT_MONITOR_INTERVAL_SEC = 1.0
SESSION_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,128}$")


@dataclass(frozen=True)
class LifecycleConfig:
    """Lifecycle behavior configuration for server shutdown/session tracking."""

    mode: str = DEFAULT_LIFECYCLE_MODE
    session_timeout_sec: float = DEFAULT_SESSION_TIMEOUT_SEC
    idle_grace_sec: float = DEFAULT_IDLE_GRACE_SEC
    monitor_interval_sec: float = DEFAULT_MONITOR_INTERVAL_SEC


class LifecycleController:
    """Track active UI sessions and decide whether the server should auto-stop."""

    def __init__(self, config: LifecycleConfig) -> None:
        self.config = config
        self._lock = threading.Lock()
        self._session_seen_at: dict[str, float] = {}
        self._had_session = False
        self._empty_since_monotonic: float | None = None

    def _prune_locked(self, now_monotonic: float) -> None:
        timeout = max(self.config.session_timeout_sec, 0.0)
        expired = [
            session_id
            for session_id, seen_at in self._session_seen_at.items()
            if now_monotonic - seen_at > timeout
        ]
        for session_id in expired:
            self._session_seen_at.pop(session_id, None)

    def heartbeat(self, session_id: str, now_monotonic: float | None = None) -> int:
        now = time.monotonic() if now_monotonic is None else float(now_monotonic)
        with self._lock:
            self._prune_locked(now)
            self._session_seen_at[session_id] = now
            self._had_session = True
            self._empty_since_monotonic = None
            return len(self._session_seen_at)

    def active_session_count(self, now_monotonic: float | None = None) -> int:
        now = time.monotonic() if now_monotonic is None else float(now_monotonic)
        with self._lock:
            self._prune_locked(now)
            return len(self._session_seen_at)

    def should_shutdown(self, now_monotonic: float | None = None) -> bool:
        if self.config.mode != LIFECYCLE_MODE_SHUTDOWN_ON_LAST_TAB:
            return False

        now = time.monotonic() if now_monotonic is None else float(now_monotonic)
        with self._lock:
            self._prune_locked(now)
            active = len(self._session_seen_at)
            if active > 0:
                self._empty_since_monotonic = None
                return False
            if not self._had_session:
                return False
            if self._empty_since_monotonic is None:
                self._empty_since_monotonic = now
                return False
            return (now - self._empty_since_monotonic) >= max(
                self.config.idle_grace_sec,
                0.0,
            )


class ThemeDesignerHTTPServer(ThreadingHTTPServer):
    """Threading server with lifecycle tracking hooks."""

    daemon_threads = True

    def __init__(
        self,
        server_address: tuple[str, int],
        handler_class: type[BaseHTTPRequestHandler],
        lifecycle_controller: LifecycleController,
    ) -> None:
        super().__init__(server_address, handler_class)
        self.lifecycle_controller = lifecycle_controller


def _new_session_id() -> str:
    return uuid.uuid4().hex


def _normalize_session_id(raw: Any) -> str:
    if raw is None:
        return _new_session_id()
    if not isinstance(raw, str):
        raise ValueError("session_id must be a string when provided.")
    value = raw.strip()
    if not value:
        return _new_session_id()
    if not SESSION_ID_PATTERN.match(value):
        raise ValueError(
            "session_id must match [A-Za-z0-9_-] and be 1-128 characters long."
        )
    return value


def _default_lifecycle_config() -> LifecycleConfig:
    return LifecycleConfig()


class ThemeDesignerHandler(BaseHTTPRequestHandler):
    """Serve the Theme Designer UI and backend JSON endpoints."""

    def _send_json(self, status_code: int, payload: Dict[str, Any]) -> None:
        raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def _send_bytes(self, status_code: int, body: bytes, content_type: str) -> None:
        self.send_response(status_code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _parse_json_body(self) -> Dict[str, Any]:
        length = int(self.headers.get("Content-Length", "0"))
        if length == 0:
            return {}
        raw = self.rfile.read(length).decode("utf-8")
        if not raw.strip():
            return {}
        data = json.loads(raw)
        if not isinstance(data, dict):
            raise ValueError("JSON body must be an object.")
        return data

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/":
            self._send_bytes(200, HTML_PAGE.encode("utf-8"), "text/html; charset=utf-8")
            return

        if path == "/api/state":
            with STATE_LOCK:
                payload = _build_response_state()
            self._send_json(200, payload)
            return

        if path == "/api/pdf":
            try:
                query = parse_qs(parsed.query)
                requested_pdf = query.get("path", [""])[0]
                if not requested_pdf:
                    state = _load_state()
                    requested_pdf = state.get("compile_output_pdf", "main.pdf")
                pdf_abs, pdf_rel = _resolve_workspace_pdf(requested_pdf)
            except ValueError as err:
                self._send_json(400, {"error": str(err)})
                return

            if not pdf_abs.exists():
                self._send_json(404, {"error": f"{pdf_rel} not found. Compile first."})
                return

            body = pdf_abs.read_bytes()
            self._send_bytes(200, body, "application/pdf")
            return

        self._send_json(404, {"error": f"Unknown path: {self.path}"})

    def do_POST(self) -> None:  # noqa: N802
        if self.path == "/api/session-heartbeat":
            try:
                payload = self._parse_json_body()
                session_id = _normalize_session_id(payload.get("session_id"))
                controller = getattr(self.server, "lifecycle_controller", None)
                active_sessions = (
                    controller.heartbeat(session_id) if controller is not None else 0
                )
                lifecycle_config = (
                    controller.config if controller is not None else _default_lifecycle_config()
                )
                self._send_json(
                    200,
                    {
                        "session_id": session_id,
                        "active_sessions": active_sessions,
                        "lifecycle_mode": lifecycle_config.mode,
                        "session_timeout_sec": lifecycle_config.session_timeout_sec,
                        "idle_grace_sec": lifecycle_config.idle_grace_sec,
                    },
                )
            except ValueError as err:
                self._send_json(400, {"error": str(err)})
            except Exception as err:  # pragma: no cover
                self._send_json(500, {"error": f"Failed to record heartbeat: {err}"})
            return

        if self.path == "/api/save":
            try:
                payload = self._parse_json_body()
                with STATE_LOCK:
                    current = _load_state()
                    normalized = _normalize_payload(payload, current)
                    _write_override_files(normalized)
                    response = _build_response_state()
                self._send_json(200, response)
            except ValueError as err:
                self._send_json(400, {"error": str(err)})
            except Exception as err:  # pragma: no cover - defensive path
                self._send_json(500, {"error": f"Failed to save: {err}"})
            return

        if self.path == "/api/target":
            try:
                payload = self._parse_json_body()
                with STATE_LOCK:
                    current = _load_state()
                    if "compile_target" not in payload:
                        raise ValueError("Missing compile_target in request payload.")
                    selected = _normalize_compile_target(
                        payload.get("compile_target"),
                        current.get("compile_targets", []),
                    )
                    _apply_compile_preferences(current, compile_target=selected)
                    _persist_ui_state(current)
                    response = _build_response_state()
                self._send_json(200, response)
            except ValueError as err:
                self._send_json(400, {"error": str(err)})
            except Exception as err:  # pragma: no cover
                self._send_json(500, {"error": f"Failed to set compile target: {err}"})
            return

        if self.path == "/api/compile-config":
            try:
                payload = self._parse_json_body()
                with STATE_LOCK:
                    current = _load_state()
                    normalized = _normalize_payload(payload, current)
                    _, selected_recipe, use_internal = _extract_compile_preferences(
                        normalized
                    )
                    _apply_compile_preferences(
                        current,
                        compile_recipe=selected_recipe,
                        use_internal_fallback=use_internal,
                    )
                    _persist_ui_state(current)
                    response = _build_response_state()
                self._send_json(200, response)
            except ValueError as err:
                self._send_json(400, {"error": str(err)})
            except Exception as err:  # pragma: no cover
                self._send_json(500, {"error": f"Failed to set compile config: {err}"})
            return

        if self.path == "/api/block-preset":
            try:
                payload = self._parse_json_body()
                with STATE_LOCK:
                    current = _load_state()
                    selected = payload.get("block_preset", current.get("block_preset", "default"))
                    _apply_block_preset(current, selected)
                    _write_override_files(current)
                    response = _build_response_state()
                self._send_json(200, response)
            except ValueError as err:
                self._send_json(400, {"error": str(err)})
            except Exception as err:  # pragma: no cover
                self._send_json(500, {"error": f"Failed to apply block preset: {err}"})
            return

        if self.path == "/api/heading-toc-preset":
            try:
                payload = self._parse_json_body()
                with STATE_LOCK:
                    current = _load_state()
                    selected = payload.get(
                        "heading_toc_preset",
                        current.get("heading_toc_preset", "default"),
                    )
                    _apply_heading_toc_preset(current, selected)
                    _write_override_files(current)
                    response = _build_response_state()
                self._send_json(200, response)
            except ValueError as err:
                self._send_json(400, {"error": str(err)})
            except Exception as err:  # pragma: no cover
                self._send_json(500, {"error": f"Failed to apply heading/TOC preset: {err}"})
            return

        if self.path == "/api/reset":
            try:
                with STATE_LOCK:
                    _delete_override_files()
                    response = _build_response_state()
                self._send_json(200, response)
            except Exception as err:  # pragma: no cover
                self._send_json(500, {"error": f"Failed to reset: {err}"})
            return

        if self.path == "/api/compile":
            try:
                payload = self._parse_json_body()
                with STATE_LOCK:
                    current = _load_state()
                    normalized = _normalize_payload(payload, current)
                    selected, selected_recipe, use_internal = _extract_compile_preferences(
                        normalized
                    )
                    _apply_compile_preferences(
                        current,
                        compile_target=selected,
                        compile_recipe=selected_recipe,
                        use_internal_fallback=use_internal,
                    )
                    _persist_ui_state(current)
                    success, output, pdf_path = _compile_tex_target(
                        selected,
                        selected_recipe,
                        use_internal,
                    )
                    _apply_compile_result(current, success, pdf_path)
                    _persist_ui_state(current)

                self._send_json(
                    200,
                    {
                        "success": success,
                        "output": output,
                        "compile_target": selected,
                        "compile_recipe": selected_recipe,
                        "compile_use_internal_fallback": use_internal,
                        "pdf_path": pdf_path,
                        "compile_output_pdf_expected": current.get("compile_output_pdf_expected", ""),
                        "compile_last_compile_at": current.get("compile_last_compile_at", ""),
                        "compile_last_success": current.get("compile_last_success"),
                        "class_config": current.get("class_config", {}),
                        "detected_document_class": current.get("detected_document_class", ""),
                        "detected_document_class_has_chapter": current.get(
                            "detected_document_class_has_chapter",
                            False,
                        ),
                        "effective_theme_class": current.get("effective_theme_class", "article"),
                    },
                )
            except ValueError as err:
                self._send_json(400, {"error": str(err)})
            except Exception as err:  # pragma: no cover
                self._send_json(500, {"error": f"Compile failed: {err}"})
            return

        self._send_json(404, {"error": f"Unknown path: {self.path}"})


def _parse_port_arg(raw: str) -> int | str:
    value = raw.strip().lower()
    if value == PORT_AUTO:
        return PORT_AUTO

    try:
        parsed = int(value)
    except ValueError as err:
        raise argparse.ArgumentTypeError(
            "Port must be an integer in [0, 65535] or 'auto'."
        ) from err

    if parsed < 0 or parsed > 65535:
        raise argparse.ArgumentTypeError(
            "Port must be an integer in [0, 65535] or 'auto'."
        )
    return parsed


def _is_address_in_use(err: OSError) -> bool:
    return err.errno == errno.EADDRINUSE or "Address already in use" in str(err)


def _format_bound_url(host: str, port: int) -> str:
    render_host = host
    if ":" in host and not host.startswith("["):
        render_host = f"[{host}]"
    return f"http://{render_host}:{port}"


def _parse_lifecycle_mode_arg(raw: str) -> str:
    value = raw.strip().lower()
    if value in LIFECYCLE_MODES:
        return value
    raise argparse.ArgumentTypeError(
        f"Lifecycle mode must be one of: {', '.join(LIFECYCLE_MODES)}."
    )


def _parse_positive_float_arg(raw: str) -> float:
    try:
        value = float(raw)
    except ValueError as err:
        raise argparse.ArgumentTypeError("Value must be a positive number.") from err
    if value <= 0:
        raise argparse.ArgumentTypeError("Value must be a positive number.")
    return value


def _parse_non_negative_float_arg(raw: str) -> float:
    try:
        value = float(raw)
    except ValueError as err:
        raise argparse.ArgumentTypeError("Value must be a non-negative number.") from err
    if value < 0:
        raise argparse.ArgumentTypeError("Value must be a non-negative number.")
    return value


def _bind_with_auto_port(
    host: str,
    start_port: int,
    lifecycle_controller: LifecycleController,
) -> ThemeDesignerHTTPServer:
    for candidate in range(max(0, start_port), 65536):
        try:
            return ThemeDesignerHTTPServer(
                (host, candidate),
                ThemeDesignerHandler,
                lifecycle_controller,
            )
        except OSError as err:
            if _is_address_in_use(err):
                continue
            raise
    raise OSError(f"No available port found on host {host} from {start_port} to 65535.")


def _resolve_server(
    host: str,
    port: int | str,
    lifecycle_config: LifecycleConfig | None = None,
) -> tuple[ThemeDesignerHTTPServer, str]:
    resolved_config = lifecycle_config or _default_lifecycle_config()
    lifecycle_controller = LifecycleController(resolved_config)

    if isinstance(port, str):
        if port.strip().lower() != PORT_AUTO:
            raise ValueError(f"Unsupported port mode: {port}")
        server = _bind_with_auto_port(host, AUTO_PORT_START, lifecycle_controller)
    else:
        try:
            server = ThemeDesignerHTTPServer(
                (host, port),
                ThemeDesignerHandler,
                lifecycle_controller,
            )
        except OSError as err:
            if port != 0 and _is_address_in_use(err):
                raise OSError(
                    f"Port {port} on {host} is already in use. "
                    "Retry with '--port auto' or '--port 0'."
                ) from err
            raise

    bound_host = str(server.server_address[0])
    bound_port = int(server.server_address[1])
    return server, _format_bound_url(bound_host, bound_port)


def _lifecycle_shutdown_watchdog(
    server: ThemeDesignerHTTPServer,
    stop_event: threading.Event,
) -> None:
    controller = getattr(server, "lifecycle_controller", None)
    if controller is None:
        return

    interval = max(controller.config.monitor_interval_sec, 0.2)
    while not stop_event.wait(interval):
        if controller.should_shutdown():
            print(
                "No active Theme Designer sessions after idle grace; shutting down server."
            )
            server.shutdown()
            return


def run_server(
    host: str,
    port: int | str,
    open_browser: bool,
    lifecycle_config: LifecycleConfig | None = None,
) -> None:
    resolved_lifecycle = lifecycle_config or _default_lifecycle_config()
    server, url = _resolve_server(host, port, resolved_lifecycle)
    print(f"Theme designer running at {url}")
    print(
        "Lifecycle mode: "
        f"{resolved_lifecycle.mode} "
        f"(session timeout: {resolved_lifecycle.session_timeout_sec:.1f}s, "
        f"idle grace: {resolved_lifecycle.idle_grace_sec:.1f}s)"
    )
    print("Press Ctrl+C to stop.")
    if open_browser:
        webbrowser.open(url)

    monitor_stop = threading.Event()
    monitor_thread: threading.Thread | None = None
    if resolved_lifecycle.mode == LIFECYCLE_MODE_SHUTDOWN_ON_LAST_TAB:
        monitor_thread = threading.Thread(
            target=_lifecycle_shutdown_watchdog,
            args=(server, monitor_stop),
            daemon=True,
        )
        monitor_thread.start()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nKeyboard interrupt received. Shutting down server.")
        print(
            "Browser auto-close is best-effort only and not enforced due browser security constraints."
        )
    finally:
        monitor_stop.set()
        if monitor_thread is not None:
            monitor_thread.join(timeout=2.0)
        server.server_close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Run local UI for theme tuning.")
    parser.add_argument(
        "--host",
        default=DEFAULT_HOST,
        help=f"Host to bind (default: {DEFAULT_HOST})",
    )
    parser.add_argument(
        "--port",
        type=_parse_port_arg,
        default=DEFAULT_PORT,
        help=(
            f"Port to bind (default: {DEFAULT_PORT}). "
            "Use 0 for OS-assigned free port, or 'auto' to fallback to next free port."
        ),
    )
    parser.add_argument(
        "--open-browser",
        action="store_true",
        help="Open default browser automatically after startup.",
    )
    parser.add_argument(
        "--lifecycle-mode",
        type=_parse_lifecycle_mode_arg,
        default=DEFAULT_LIFECYCLE_MODE,
        help=(
            "Lifecycle mode: 'manual' keeps server running until Ctrl+C; "
            "'shutdown-on-last-tab' auto-stops when all sessions expire."
        ),
    )
    parser.add_argument(
        "--session-timeout-sec",
        type=_parse_positive_float_arg,
        default=DEFAULT_SESSION_TIMEOUT_SEC,
        help=(
            "Session expiry timeout in seconds for heartbeat tracking "
            f"(default: {DEFAULT_SESSION_TIMEOUT_SEC:.1f})."
        ),
    )
    parser.add_argument(
        "--idle-grace-sec",
        type=_parse_non_negative_float_arg,
        default=DEFAULT_IDLE_GRACE_SEC,
        help=(
            "Extra idle grace period before auto-shutdown when no sessions remain "
            f"(default: {DEFAULT_IDLE_GRACE_SEC:.1f})."
        ),
    )
    args = parser.parse_args()
    try:
        lifecycle_config = LifecycleConfig(
            mode=args.lifecycle_mode,
            session_timeout_sec=args.session_timeout_sec,
            idle_grace_sec=args.idle_grace_sec,
            monitor_interval_sec=DEFAULT_MONITOR_INTERVAL_SEC,
        )
        run_server(
            args.host,
            args.port,
            args.open_browser,
            lifecycle_config=lifecycle_config,
        )
    except OSError as err:
        raise SystemExit(f"Failed to start Theme Designer: {err}") from err
