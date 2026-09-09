"""Threat overlay must match request identity, not paint a whole IP/path."""

from datetime import datetime, timezone
from types import SimpleNamespace

from server.api.routers.stream import (
    _attacks_for_log,
    _malicious_record_path,
    _threat_overlay,
)


def _event(**kwargs):
    defaults = {
        "ip": "198.51.100.10",
        "category": "SQL Injection",
        "severity": "HIGH",
        "method": "GET",
        "url": "/orders",
        "host": "",
        "detected_at": 1_710_000_000_000,
    }
    defaults.update(kwargs)
    return SimpleNamespace(**defaults)


def _log(**kwargs):
    defaults = {
        "source_ip": "198.51.100.10",
        "method": "GET",
        "path": "/orders",
        "created_at": datetime.fromtimestamp(1_710_000_000, tz=timezone.utc),
    }
    defaults.update(kwargs)
    return SimpleNamespace(**defaults)


def test_malicious_record_path_strips_host_prefix_when_host_column_empty():
    record = _event(url="pay.example/orders/42", host="")
    assert _malicious_record_path(record) == "/orders/42"


def test_malicious_record_path_keeps_leading_slash_paths():
    record = _event(url="/orders?token=secret", host="")
    assert _malicious_record_path(record) == "/orders"


def test_threat_overlay_does_not_paint_later_requests_outside_window():
    overlay = _threat_overlay([
        _event(detected_at=1_710_000_000_000),
    ])
    # Same IP/path/method five seconds later must not inherit the hit.
    later = _log(created_at=datetime.fromtimestamp(1_710_000_005, tz=timezone.utc))
    assert _attacks_for_log(overlay, later) == []


def test_threat_overlay_matches_within_two_second_window():
    overlay = _threat_overlay([
        _event(detected_at=1_710_000_000_500),
    ])
    near = _log(created_at=datetime.fromtimestamp(1_710_000_000, tz=timezone.utc))
    hits = _attacks_for_log(overlay, near)
    assert hits == [{"category": "SQL Injection", "severity": "HIGH"}]


def test_threat_overlay_requires_matching_method():
    overlay = _threat_overlay([
        _event(method="POST", detected_at=1_710_000_000_000),
    ])
    get_log = _log(method="GET")
    assert _attacks_for_log(overlay, get_log) == []
