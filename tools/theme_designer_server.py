#!/usr/bin/env python3
"""HTTP server layer for Theme Designer."""

from __future__ import annotations

import argparse
import json
import webbrowser
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


def run_server(host: str, port: int, open_browser: bool) -> None:
    server = ThreadingHTTPServer((host, port), ThemeDesignerHandler)
    url = f"http://{host}:{port}"
    print(f"Theme designer running at {url}")
    print("Press Ctrl+C to stop.")
    if open_browser:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down...")
    finally:
        server.server_close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Run local UI for theme tuning.")
    parser.add_argument("--host", default="127.0.0.1", help="Host to bind (default: 127.0.0.1)")
    parser.add_argument("--port", type=int, default=8765, help="Port to bind (default: 8765)")
    parser.add_argument(
        "--open-browser",
        action="store_true",
        help="Open default browser automatically after startup.",
    )
    args = parser.parse_args()
    run_server(args.host, args.port, args.open_browser)
