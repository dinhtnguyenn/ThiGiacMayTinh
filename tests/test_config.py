from __future__ import annotations

import unittest
from dataclasses import replace

from server.config import DEVELOPMENT_SECRET, Settings


class SettingsTests(unittest.TestCase):
    def test_default_settings_are_valid_for_development(self) -> None:
        settings = Settings.from_environment()

        settings.validate_for_startup()

    def test_production_rejects_the_development_secret(self) -> None:
        settings = replace(
            Settings.from_environment(),
            app_env="production",
            signing_secret=DEVELOPMENT_SECRET,
        )

        with self.assertRaisesRegex(RuntimeError, "FACEOPS_SIGNING_SECRET"):
            settings.validate_for_startup()

    def test_production_requires_a_long_admin_token(self) -> None:
        settings = replace(
            Settings.from_environment(),
            app_env="production",
            signing_secret="a-production-signing-secret",
            admin_token="too-short",
        )

        with self.assertRaisesRegex(RuntimeError, "FACEOPS_ADMIN_TOKEN"):
            settings.validate_for_startup()

    def test_pending_registration_ttl_must_be_at_least_thirty_seconds(self) -> None:
        settings = replace(Settings.from_environment(), pending_registration_ttl_seconds=29)

        with self.assertRaisesRegex(RuntimeError, "FACEOPS_PENDING_REGISTRATION_TTL_SECONDS"):
            settings.validate_for_startup()

if __name__ == "__main__":
    unittest.main()
