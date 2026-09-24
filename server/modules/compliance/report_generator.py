from typing import Dict, Any, List, Optional
from sqlalchemy.future import select
from server.models.core import Vulnerability
from server.modules.persistence.database import AsyncSessionLocal
from server.modules.compliance.mapper import ComplianceMapper
from server.modules.utils.redactor import Redactor
import logging

logger = logging.getLogger(__name__)


def sanitize_compliance_report_value(value: Any) -> Any:
    """Redact secrets from values before compliance report export/rendering."""
    if isinstance(value, dict):
        return {
            str(key): sanitize_compliance_report_value(item_value)
            for key, item_value in value.items()
        }
    if isinstance(value, list):
        return [sanitize_compliance_report_value(item) for item in value]
    if isinstance(value, str):
        return Redactor.redact_text(value)
    return value


# Maps a report `framework` name to the matching field ComplianceMapper.map_category()
# returns. ComplianceMapper already carries the per-category control mappings for all
# seven frameworks (mapper.py) — this generator reuses that single source of truth
# instead of maintaining its own, narrower per-framework table.
_FRAMEWORK_MAP_FIELDS = {
    "OWASP_API_2023": "owasp_api",
    "GDPR": "gdpr",
    "HIPAA": "hipaa",
    "PCI_DSS_V4": "pci",
    "SOC2": "soc2",
    "NIST_SP_800_204C": "nist",
    "EU_AI_ACT": "eu_ai_act",
}


class ComplianceReportGenerator:
    """
    Groups vulnerabilities into industry standard compliance frameworks.
    """

    def __init__(self) -> None:
        self._mapper = ComplianceMapper()

    @property
    def FRAMEWORKS(self) -> List[str]:
        """Supported framework names (kept for backward compatibility with callers
        that inspected the old dict's keys)."""
        return list(_FRAMEWORK_MAP_FIELDS.keys())

    def _section_label(self, map_field: str, value: Any) -> str:
        if map_field == "owasp_api" and isinstance(value, dict):
            return f"{value['id']} - {value['name']}" if value.get("id") != "UNKNOWN" else "Miscellaneous"
        if isinstance(value, str) and value != "No direct mapping":
            return value
        return "Miscellaneous"

    async def generate(self, account_id: int, framework: str = "OWASP_API_2023") -> Dict[str, Any]:
        """
        Gathers OPEN vulnerabilities for the given account and maps them to framework categories.
        """
        framework = (framework or "OWASP_API_2023").upper()
        map_field = _FRAMEWORK_MAP_FIELDS.get(framework)

        async with AsyncSessionLocal() as session:
            stmt = select(Vulnerability).where(
                Vulnerability.account_id == account_id,
                Vulnerability.status == "OPEN"
            )
            result = await session.execute(stmt)
            vulns = result.scalars().all()

            report: Dict[str, Any] = {
                "framework": framework,
                "total_open": len(vulns),
                "sections": {},
            }

            if map_field is None:
                report["error"] = (
                    f"Unknown framework '{framework}'. Supported: {sorted(_FRAMEWORK_MAP_FIELDS)}"
                )
                return report

            for vuln in vulns:
                mapping = self._mapper.map_category(vuln.type or "UNKNOWN")
                section_label = self._section_label(map_field, mapping[map_field])

                report["sections"].setdefault(
                    sanitize_compliance_report_value(section_label),
                    [],
                ).append({
                    "id": vuln.id,
                    "title": sanitize_compliance_report_value(vuln.template_id),
                    "severity": sanitize_compliance_report_value(vuln.severity),
                    "endpoint": sanitize_compliance_report_value(f"{vuln.method} {vuln.url}")
                })

            return report
